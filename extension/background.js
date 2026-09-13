/**
 * Aalto background service worker — the orchestrator.
 *
 * Everything that must outlive the popup lives here. The popup is only a view:
 * it starts and stops recording and renders state. If the user closes it
 * mid-command (or Aalto opens a tab, which closes it automatically), the command
 * still runs to completion and still speaks its summary.
 */

const OFFSCREEN_PATH = "offscreen.html";
const DEFAULT_SERVER = "http://localhost:8787";

/** Mirrored into chrome.storage.local so a re-opened popup can pick up mid-flight. */
const state = {
  phase: "idle", // idle | recording | thinking | working | done | error
  transcript: "",
  summary: "",
  tasks: [], // { id, tool, status, detail }
  error: "",
};

async function setState(patch) {
  Object.assign(state, patch);
  await chrome.storage.local.set({ aaltoState: state });
  // The popup may be closed; nobody listening is not an error.
  chrome.runtime.sendMessage({ type: "STATE", state }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target === "offscreen") return false;

  switch (message.type) {
    case "START_RECORDING":
      beginRecording()
        .then((outcome) => sendResponse({ ok: true, ...outcome }))
        .catch((err) => {
          setState({ phase: "error", error: err.message });
          sendResponse({ ok: false, error: err.message });
        });
      return true;

    case "STOP_RECORDING":
      finishRecording()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          setState({ phase: "error", error: err.message });
          sendResponse({ ok: false, error: err.message });
        });
      return true;

    case "GET_STATE":
      sendResponse({ state });
      return false;

    case "STOP_AUDIO":
      sendToOffscreen({ type: "STOP_AUDIO" }).catch(() => {});
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});

// --- offscreen document lifecycle ------------------------------------------

let creating = null;

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  if (existing.length > 0) return;

  // Concurrent calls would otherwise race and throw "Only a single offscreen
  // document may be created".
  if (creating) {
    await creating;
    return;
  }
  creating = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
    justification: "Record voice commands and speak responses beyond the popup's lifetime.",
  });
  try {
    await creating;
  } finally {
    creating = null;
  }
}

async function sendToOffscreen(message) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ ...message, target: "offscreen" });
  if (!res?.ok) {
    const err = new Error(res?.error ?? "offscreen worker did not respond");
    err.name = res?.name ?? "Error";
    throw err;
  }
  return res;
}

/** True for the one failure the user can actually fix, via the permission page. */
function isPermissionProblem(err) {
  return (
    err?.name === "NotAllowedError" ||
    err?.name === "SecurityError" ||
    /permission|denied|not ?allowed/i.test(err?.message ?? "")
  );
}

async function openPermissionPage() {
  const url = chrome.runtime.getURL("permission.html");
  const [existing] = await chrome.tabs.query({ url });
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    return;
  }
  await chrome.tabs.create({ url });
}

// --- the command flow -------------------------------------------------------

async function beginRecording() {
  await setState({ phase: "recording", transcript: "", summary: "", tasks: [], error: "" });
  try {
    await sendToOffscreen({ type: "START_RECORDING" });
  } catch (err) {
    if (isPermissionProblem(err)) {
      // An offscreen document can use the microphone but cannot prompt for it,
      // so send the user to a real page that can.
      await chrome.storage.local.set({ micGranted: false });
      await setState({
        phase: "needs_mic",
        error: "Aalto needs permission to use your microphone.",
      });
      await openPermissionPage();
      return { needsMic: true };
    }
    throw err;
  }
  return { started: true };
}

async function finishRecording() {
  const { audioBase64 } = await sendToOffscreen({ type: "STOP_RECORDING" });
  await setState({ phase: "thinking" });
  await runCommand(audioBase64);
}

async function runCommand(audioBase64) {
  const settings = await chrome.storage.local.get(["serverUrl", "langHint", "muted", "apiKey"]);
  const serverUrl = (settings.serverUrl || DEFAULT_SERVER).replace(/\/$/, "");
  const headers = settings.apiKey ? { "x-aalto-key": settings.apiKey } : {};

  try {
    const form = new FormData();
    form.append("audio", base64ToBlob(audioBase64, "audio/webm"), "command.webm");
    if (settings.langHint) form.append("languageCode", settings.langHint);
    form.append("context", JSON.stringify({ openTabs: await openTabSummary() }));

    const res = await fetch(`${serverUrl}/api/voice-command`, {
      method: "POST",
      body: form,
      headers,
    });
    if (!res.ok) throw new Error(await describeHttpError(res));
    const data = await res.json();

    if (!data.transcript) {
      await setState({ phase: "done", summary: data.summary ?? "I didn't hear anything." });
      return;
    }

    // Show every planned task immediately, so the user sees the fan-out happen
    // rather than staring at a spinner.
    const pending = (data.browserTasks ?? []).map((t) => ({
      id: t.id,
      tool: t.tool,
      status: "pending",
      detail: "",
    }));
    await setState({
      phase: "working",
      transcript: data.transcript,
      tasks: [...(data.serverResults ?? []), ...pending],
    });

    const browserResults = await executeBrowserTasks(data.browserTasks ?? []);
    const allResults = [...(data.serverResults ?? []), ...browserResults];
    await setState({ tasks: allResults });

    const done = await fetch(`${serverUrl}/api/complete`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ results: allResults, muted: settings.muted === true }),
    });
    if (!done.ok) throw new Error(await describeHttpError(done));
    const { summary, audioUrl } = await done.json();

    await setState({ phase: "done", summary });
    if (audioUrl && settings.muted !== true) {
      await sendToOffscreen({ type: "PLAY_AUDIO", url: audioUrl }).catch(() => {});
    }
  } catch (err) {
    await setState({ phase: "error", error: err.message });
  }
}

/**
 * Run the browser-side tasks.
 *
 * Form fields go one at a time and in order - they target a single page and
 * racing them would interleave keystrokes across fields. Everything else runs
 * concurrently. One task failing never stops the others.
 */
async function executeBrowserTasks(tasks) {
  const formTasks = tasks.filter((t) => t.tool === "fill_form_field" || t.tool === "submit_form");
  const otherTasks = tasks.filter((t) => !formTasks.includes(t));

  const runOne = async (task) => {
    try {
      const detail = await executeAction(task);
      await markTask(task.id, "ok", detail);
      return { id: task.id, tool: task.tool, status: "ok", detail };
    } catch (err) {
      await markTask(task.id, "failed", err.message);
      return { id: task.id, tool: task.tool, status: "failed", detail: err.message };
    }
  };

  const sequential = (async () => {
    const out = [];
    for (const task of formTasks) out.push(await runOne(task));
    return out;
  })();

  const [formResults, otherResults] = await Promise.all([
    sequential,
    Promise.all(otherTasks.map(runOne)),
  ]);

  // Restore the order the user spoke them in.
  const byId = new Map([...formResults, ...otherResults].map((r) => [r.id, r]));
  return tasks.map((t) => byId.get(t.id)).filter(Boolean);
}

async function markTask(id, status, detail) {
  const tasks = state.tasks.map((t) => (t.id === id ? { ...t, status, detail } : t));
  await setState({ tasks });
}

async function executeAction(action) {
  switch (action.tool) {
    case "search_web": {
      const query = action.input.query;
      await chrome.tabs.create({
        url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      });
      return `searched for "${query}"`;
    }

    case "open_url": {
      const url = normalizeUrl(action.input.url);
      await chrome.tabs.create({ url });
      return `opened ${hostOf(url)}`;
    }

    case "switch_tab":
      return await switchTab(action.input.description);

    case "fill_form_field":
    case "submit_form":
      return await sendToActiveTab(action);

    default:
      throw new Error(`don't know how to ${action.tool}`);
  }
}

async function sendToActiveTab(action) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) throw new Error("no active tab to work with");

  let res;
  try {
    res = await chrome.tabs.sendMessage(activeTab.id, { type: "FORM_ACTION", action });
  } catch {
    // The content script only runs on Google Forms pages.
    throw new Error("that page doesn't look like a form I can fill");
  }
  if (!res?.ok) throw new Error(res?.error ?? "the form field didn't match anything");
  return res.detail;
}

function normalizeUrl(url) {
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function openTabSummary() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((t) => t.title && t.url && !t.url.startsWith("chrome://"))
    .slice(0, 20)
    .map((t) => ({ title: t.title, url: t.url }));
}

async function switchTab(description) {
  const desc = (description ?? "").toLowerCase();
  const tabs = await chrome.tabs.query({ currentWindow: true });

  if (desc.includes("next")) return cycleTab(tabs, 1);
  if (desc.includes("previous") || desc.includes("back")) return cycleTab(tabs, -1);

  const match = tabs.find(
    (t) => t.title?.toLowerCase().includes(desc) || t.url?.toLowerCase().includes(desc)
  );
  if (!match?.id) throw new Error(`no open tab matching "${description}"`);
  await chrome.tabs.update(match.id, { active: true });
  return `switched to ${match.title}`;
}

async function cycleTab(tabs, direction) {
  const active = tabs.find((t) => t.active);
  if (!active) throw new Error("no active tab");
  const sorted = [...tabs].sort((a, b) => a.index - b.index);
  const currentIdx = sorted.findIndex((t) => t.id === active.id);
  const next = sorted[(currentIdx + direction + sorted.length) % sorted.length];
  await chrome.tabs.update(next.id, { active: true });
  return `switched to ${next.title}`;
}

function base64ToBlob(base64, type) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function describeHttpError(res) {
  if (res.status === 401) return "the server rejected the request key";
  try {
    const body = await res.json();
    return body.error ?? `server error ${res.status}`;
  } catch {
    return `server error ${res.status}`;
  }
}

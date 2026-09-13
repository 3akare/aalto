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
const SHORTCUT_COMMAND = "start-listening";
// Sahara requires a language code and its codes name code-switch pairs; "pcm" is
// the Pidgin-English model. Sending nothing lands on English, which anglicises
// Pidgin rather than transcribing it.
const DEFAULT_LANGUAGE = "pcm";

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
      sendToOffscreen({ type: "STOP_STREAM" })
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    // The offscreen document relays everything the server says; it owns the
    // socket because it owns the microphone, but the state machine lives here.
    case "STREAM_EVENT":
      onStreamEvent(message.event).catch((err) => setState({ phase: "error", error: err.message }));
      return false;

    case "CANCEL_RECORDING":
      cancelRecording().catch(() => {});
      sendResponse({ ok: true });
      return false;

    case "POPUP_OPENED": {
      const autoStart = summonedByShortcut;
      summonedByShortcut = false;
      sendResponse({ state, autoStart });
      return false;
    }

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

// The popup auto-starts recording when it opens, so binding the shortcut to
// _execute_action is all that is needed: press it anywhere and start talking.
// Pressing the shortcut IS the request to talk, so the popup it opens should
// already be listening. Opening the popup by hand should not: a window that
// starts recording the moment you glance at it is unnerving. The popup asks
// which happened, and this flag is consumed on read so it never leaks into the
// next manual open.
let summonedByShortcut = false;

chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== SHORTCUT_COMMAND) return;

  // Deliberately NOT the reserved _execute_action: Chrome handles that one
  // natively and never dispatches onCommand, so the worker could not tell a
  // shortcut press from a toolbar click.
  //
  // Recording starts HERE rather than waiting for the popup to open and ask.
  // The popup is only a view - the offscreen document does the recording - so
  // tying the shortcut to chrome.action.openPopup() (Chrome 127+, and refused
  // in some window states) meant the whole feature failed wherever that call
  // did. Pressing the shortcut now records regardless; the window is opened
  // afterwards, best effort, purely so there is something to look at.
  const busy = state.phase === "thinking" || state.phase === "working";
  if (busy) return;

  if (state.phase === "recording") {
    // A second press is the natural way to say "stop", and the only way to stop
    // at all when no popup opened.
    await cancelRecording().catch(() => {});
    return;
  }

  summonedByShortcut = true;
  beginRecording().catch((err) => {
    summonedByShortcut = false;
    setState({ phase: "error", error: err.message });
  });

  try {
    await chrome.action.openPopup();
  } catch {
    // No popup on this Chrome, or not allowed right now. Recording is already
    // under way and the reply will still be spoken, so this is not fatal.
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

/** Abandon a stream without sending it anywhere. */
async function cancelRecording(message) {
  await sendToOffscreen({ type: "ABORT_STREAM" }).catch(() => {});
  await setState({ phase: "idle", summary: message ?? "", tasks: [], transcript: "" });
}

async function beginRecording() {
  const settings = await chrome.storage.local.get(["serverUrl", "langHint", "apiKey"]);
  await setState({ phase: "recording", transcript: "", summary: "", tasks: [], error: "" });

  try {
    await sendToOffscreen({
      type: "START_STREAM",
      config: {
        serverUrl: (settings.serverUrl || DEFAULT_SERVER).replace(/\/$/, ""),
        languageCode: settings.langHint || DEFAULT_LANGUAGE,
        apiKey: settings.apiKey || undefined,
        context: { openTabs: await openTabSummary(), formLabels: await activeFormLabels() },
      },
    });
  } catch (err) {
    if (isPermissionProblem(err)) {
      // An offscreen document can use the microphone but cannot prompt for it,
      // so send the user to a real page that can.
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

/**
 * React to the server's side of the stream.
 *
 * Partials are rendered as they arrive. They are throwaway text — the committed
 * transcript replaces them — but showing words appearing changes how long the
 * wait feels even when it is exactly the same wait.
 */
async function onStreamEvent(event) {
  switch (event?.type) {
    case "open":
      return;

    case "partial":
      if (state.phase === "recording") await setState({ transcript: event.text ?? "" });
      return;

    // The microphone is closed and the server is finishing up. Moving off
    // "Listening" here is what stops a slow transcription from looking like a
    // stream that never ended.
    case "committing":
      if (state.phase === "recording") await setState({ phase: "thinking" });
      return;

    case "transcript":
      await setState({ phase: "thinking", transcript: event.text ?? "" });
      return;

    case "empty":
      await setState({ phase: "done", summary: "I didn't hear anything.", transcript: "" });
      return;

    case "notice":
      console.warn("[Aalto]", event.message);
      return;

    case "error":
      await setState({ phase: "error", error: event.message ?? "the stream failed" });
      return;

    case "plan":
      await runPlan(event);
      return;

    default:
      return;
  }
}

/** Execute the browser half of a plan, then collect the spoken summary. */
async function runPlan(plan) {
  const settings = await chrome.storage.local.get(["serverUrl", "muted", "apiKey"]);
  const serverUrl = (settings.serverUrl || DEFAULT_SERVER).replace(/\/$/, "");
  const headers = settings.apiKey ? { "x-aalto-key": settings.apiKey } : {};

  try {
    // Show every planned task at once, so the fan-out is visible rather than a
    // spinner that happens to end with several things done.
    const pending = (plan.browserTasks ?? []).map((t) => ({
      id: t.id,
      tool: t.tool,
      status: "pending",
      detail: "",
    }));
    await setState({
      phase: "working",
      transcript: plan.transcript,
      tasks: [...(plan.serverResults ?? []), ...pending],
    });

    const browserResults = await executeBrowserTasks(plan.browserTasks ?? []);
    const allResults = [...(plan.serverResults ?? []), ...browserResults];
    await setState({ tasks: allResults });

    const done = await fetch(`${serverUrl}/api/complete`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ results: allResults }),
    });
    if (!done.ok) throw new Error(await describeHttpError(done));
    const { summary } = await done.json();

    // Show the answer the moment it exists; speech follows separately.
    await setState({ phase: "done", summary });
    if (settings.muted !== true) speak(serverUrl, headers, summary).catch(() => {});
  } catch (err) {
    await setState({ phase: "error", error: err.message });
  }
}

/**
 * Fetch and play the spoken reply.
 *
 * Deliberately not awaited by the caller: the written answer is already on
 * screen, and text-to-speech takes a couple of seconds that nobody should spend
 * looking at a spinner for something already decided.
 */
async function speak(serverUrl, headers, text) {
  const res = await fetch(`${serverUrl}/api/speak`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) return;
  const { audioUrl } = await res.json();
  // Re-checked here so muting mid-flight beats a request made before it.
  const { muted } = await chrome.storage.local.get("muted");
  if (audioUrl && muted !== true) {
    await sendToOffscreen({ type: "PLAY_AUDIO", url: audioUrl }).catch(() => {});
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
      // A read-back IS the reply, not a status line about one. Marking it
      // "answered" makes the summariser speak it verbatim instead of collapsing
      // it into "I reviewed the form" and throwing away the only useful part.
      const status = task.tool === "review_form" ? "answered" : "ok";
      await markTask(task.id, status, detail);
      return { id: task.id, tool: task.tool, status, detail };
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
    // active:false throughout. The user called Aalto from somewhere else and
    // should still be there when it finishes; a tab that steals focus mid-sentence
    // is the exact thing this design is trying to avoid. switch_tab is the one
    // deliberate exception, because switching is what it was asked to do.
    case "search_web": {
      const query = action.input.query;
      await chrome.tabs.create({
        url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        active: false,
      });
      return `searched for "${query}" in a background tab`;
    }

    case "open_url": {
      const url = normalizeUrl(action.input.url);
      await chrome.tabs.create({ url, active: false });
      return `opened ${hostOf(url)} in a background tab`;
    }

    case "switch_tab":
      return await switchTab(action.input.description);

    case "fill_form_field":
    case "submit_form":
      return await sendToActiveTab(action);

    case "review_form":
      return await reviewForm();

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

/** Questions on the form in the active tab, or [] when there is no form there. */
async function activeFormLabels() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return [];
    const res = await chrome.tabs.sendMessage(tab.id, { type: "LIST_FIELDS" });
    return res?.labels ?? [];
  } catch {
    // No content script on this page — not a form, and not an error.
    return [];
  }
}

/**
 * Read the form back, question by question, with whatever is currently entered.
 *
 * Phrased for speech rather than for a screen: someone filling a government form
 * by voice is checking it by ear, and "blank" is more useful to hear than silence.
 */
async function reviewForm() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("no active tab to read");

  let res;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: "READ_FIELDS" });
  } catch {
    throw new Error("that page doesn't look like a form I can read");
  }
  const fields = res?.fields ?? [];
  if (fields.length === 0) throw new Error("I couldn't find any questions on this page");

  const spoken = fields.map((f) => `${f.label}: ${f.value || "still blank"}`).join(". ");
  return `here's what the form says. ${spoken}`;
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

async function describeHttpError(res) {
  if (res.status === 401) return "the server rejected the request key";
  try {
    const body = await res.json();
    return body.error ?? `server error ${res.status}`;
  } catch {
    return `server error ${res.status}`;
  }
}

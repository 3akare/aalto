/**
 * Popup — a view, not the engine.
 *
 * Recording and the whole command flow live in the background service worker and
 * the offscreen document, so closing this window (which Chrome does automatically
 * the moment Aalto opens a tab) does not interrupt anything.
 */

const micBtn = document.getElementById("micBtn");
const muteBtn = document.getElementById("muteBtn");
const statusEl = document.getElementById("status");
const transcriptEl = document.getElementById("transcript");
const summaryEl = document.getElementById("summary");
const tasksEl = document.getElementById("tasks");
const langSelect = document.getElementById("langSelect");
const serverUrlInput = document.getElementById("serverUrl");
const apiKeyInput = document.getElementById("apiKey");

// --- settings ---------------------------------------------------------------

chrome.storage.local.get(["serverUrl", "langHint", "muted", "apiKey"], (data) => {
  if (data.serverUrl) serverUrlInput.value = data.serverUrl;
  if (data.langHint) langSelect.value = data.langHint;
  if (data.apiKey) apiKeyInput.value = data.apiKey;
  setMuteUi(data.muted === true);
});

serverUrlInput.addEventListener("change", () => {
  chrome.storage.local.set({ serverUrl: serverUrlInput.value });
});
langSelect.addEventListener("change", () => {
  chrome.storage.local.set({ langHint: langSelect.value });
});
apiKeyInput.addEventListener("change", () => {
  chrome.storage.local.set({ apiKey: apiKeyInput.value });
});

function setMuteUi(muted) {
  muteBtn.textContent = muted ? "🔇" : "🔊";
  muteBtn.setAttribute("aria-pressed", String(muted));
  muteBtn.title = muted ? "Spoken replies are off" : "Mute spoken replies";
}

muteBtn.addEventListener("click", async () => {
  const { muted } = await chrome.storage.local.get("muted");
  const next = muted !== true;
  await chrome.storage.local.set({ muted: next });
  setMuteUi(next);
  // Silence anything already mid-sentence, so the button feels immediate.
  if (next) chrome.runtime.sendMessage({ type: "STOP_AUDIO" }).catch(() => {});
});

// --- hold to talk -----------------------------------------------------------

// An explicit state machine, because start is async: a fast tap used to call
// stop before getUserMedia had resolved, so the stop was a no-op and the mic
// stayed hot with the button stuck on "Release to send".
let phase = "idle"; // idle | arming | recording | stopping

async function press() {
  if (phase !== "idle") return;
  phase = "arming";
  micBtn.textContent = "Starting…";

  const res = await chrome.runtime.sendMessage({ type: "START_RECORDING" }).catch((err) => ({
    ok: false,
    error: err.message,
  }));

  if (!res?.ok) {
    phase = "idle";
    micBtn.textContent = "Hold to talk";
    statusEl.textContent = micErrorMessage(res?.error ?? "could not start recording");
    return;
  }

  // Released during arming - honour it now rather than leaving the mic open.
  if (phase !== "arming") {
    await release(true);
    return;
  }
  phase = "recording";
  micBtn.textContent = "Release to send";
  micBtn.classList.add("listening");
  statusEl.textContent = "Listening…";
}

async function release(force = false) {
  if (phase === "arming" && !force) {
    // Mark intent; press() will finish the stop once the mic is actually live.
    phase = "stopping";
    return;
  }
  if (phase !== "recording" && !force) return;

  phase = "stopping";
  micBtn.classList.remove("listening");
  micBtn.textContent = "Hold to talk";
  statusEl.textContent = "Transcribing…";

  const res = await chrome.runtime.sendMessage({ type: "STOP_RECORDING" }).catch((err) => ({
    ok: false,
    error: err.message,
  }));
  if (!res?.ok) statusEl.textContent = `Error: ${res?.error ?? "recording failed"}`;
  phase = "idle";
}

function micErrorMessage(raw) {
  if (/denied|NotAllowed/i.test(raw)) {
    return "Microphone blocked. Allow it for this extension in Chrome's site settings.";
  }
  if (/NotFound/i.test(raw)) return "No microphone found.";
  return `Error: ${raw}`;
}

micBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  press();
});
micBtn.addEventListener("pointerup", () => release());
micBtn.addEventListener("pointerleave", () => {
  if (phase === "recording" || phase === "arming") release();
});
// Space and Enter, for anyone not using a mouse.
micBtn.addEventListener("keydown", (e) => {
  if ((e.key === " " || e.key === "Enter") && !e.repeat) {
    e.preventDefault();
    press();
  }
});
micBtn.addEventListener("keyup", (e) => {
  if (e.key === " " || e.key === "Enter") release();
});

// --- rendering --------------------------------------------------------------

const PHASE_TEXT = {
  idle: "Ready.",
  recording: "Listening…",
  thinking: "Transcribing and planning…",
  working: "Working…",
  done: "",
  error: "",
};

const MARKS = { pending: "○", ok: "✓", failed: "✕", needs_input: "?" };

function render(s) {
  if (!s) return;
  statusEl.textContent = s.phase === "error" ? `Error: ${s.error}` : (PHASE_TEXT[s.phase] ?? "");
  transcriptEl.textContent = s.transcript ? `"${s.transcript}"` : "";
  summaryEl.textContent = s.summary ?? "";

  tasksEl.replaceChildren();
  for (const task of s.tasks ?? []) {
    const li = document.createElement("li");
    li.className = task.status;

    const mark = document.createElement("span");
    mark.className = "mark";
    mark.textContent = MARKS[task.status] ?? "○";

    const body = document.createElement("span");
    if (task.detail) {
      body.textContent = task.detail;
    } else {
      const tool = document.createElement("span");
      tool.className = "tool";
      tool.textContent = task.tool.replace(/_/g, " ");
      body.append(tool);
    }

    li.append(mark, body);
    tasksEl.append(li);
  }

  // Don't let a stale "recording" state leave the button unusable after a reopen.
  micBtn.disabled = s.phase === "thinking" || s.phase === "working";
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "STATE") render(message.state);
  return false;
});

// A command may already be running from before this popup was opened.
chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
  if (chrome.runtime.lastError) return;
  render(res?.state);
});

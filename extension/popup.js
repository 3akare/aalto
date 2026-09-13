/**
 * Popup — a view, not the engine.
 *
 * It opens already listening, draws the live waveform, and shows the reply. The
 * recording and the command flow live in the background worker and the offscreen
 * document, so closing this window mid-command interrupts nothing.
 */

const stage = document.getElementById("stage");
const stageLabel = document.getElementById("stageLabel");
const wave = document.getElementById("wave");
const spinner = document.getElementById("spinner");
const idleHint = document.getElementById("idleHint");
const speakerBtn = document.getElementById("speakerBtn");

const reply = document.getElementById("reply");
const heardEl = document.getElementById("heard");
const answerEl = document.getElementById("answer");
const tasksEl = document.getElementById("tasks");

const settingsBtn = document.getElementById("settingsBtn");
const settings = document.getElementById("settings");
const serverUrlInput = document.getElementById("serverUrl");
const apiKeyInput = document.getElementById("apiKey");
const langSelect = document.getElementById("langSelect");
const shortcutHint = document.getElementById("shortcutHint");
const shortcutLink = document.getElementById("shortcutLink");

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

settingsBtn.addEventListener("click", () => {
  const open = settings.hidden;
  settings.hidden = !open;
  settingsBtn.setAttribute("aria-expanded", String(open));
});

// chrome:// URLs cannot be opened from an <a href>, so route it through tabs.
shortcutLink.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

chrome.commands?.getAll((commands) => {
  const bound = commands?.find((c) => c.name === "_execute_action");
  if (bound?.shortcut) shortcutHint.textContent = bound.shortcut;
});

function setMuteUi(muted) {
  speakerBtn.setAttribute("aria-pressed", String(muted));
  speakerBtn.title = muted ? "Spoken replies are off" : "Mute spoken replies";
  // The glyph itself is switched by CSS off aria-pressed; see popup.html.
}

speakerBtn.addEventListener("click", async (e) => {
  e.stopPropagation(); // the stage behind it toggles listening
  const { muted } = await chrome.storage.local.get("muted");
  const next = muted !== true;
  await chrome.storage.local.set({ muted: next });
  setMuteUi(next);
  if (next) chrome.runtime.sendMessage({ type: "STOP_AUDIO" }).catch(() => {});
});

// --- waveform ---------------------------------------------------------------

const BAR_COUNT = 20;
const levels = new Array(BAR_COUNT).fill(0);
const ctx = wave.getContext("2d");
let waveRaf = null;

function pushLevel(rms) {
  // Speech RMS is small and very non-linear; a cube root opens up the quiet end
  // so normal speaking shows movement rather than a flat line with rare spikes.
  const shaped = Math.min(1, (rms / 0.28) ** (1 / 3));
  levels.push(shaped);
  levels.shift();
}

function roundedBar(x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawWave() {
  const w = wave.width;
  const h = wave.height;
  ctx.clearRect(0, 0, w, h);

  const gap = 9;
  const barW = (w - gap * (BAR_COUNT - 1)) / BAR_COUNT;
  const mid = h / 2;

  for (let i = 0; i < BAR_COUNT; i++) {
    const level = levels[i];
    const barH = Math.max(barW, level * h * 0.9);
    const x = i * (barW + gap);
    // Coral where there is speech, dimmed cream for the quiet tail — the shape
    // in the sketch: a row of lozenges that swell as you talk.
    ctx.fillStyle = level > 0.06 ? "#cc785c" : "rgba(160, 157, 150, 0.34)";
    roundedBar(x, mid - barH / 2, barW, barH, barW / 2);
    ctx.fill();
  }
  waveRaf = requestAnimationFrame(drawWave);
}

function startWave() {
  if (!waveRaf) drawWave();
}

function stopWave() {
  if (waveRaf) {
    cancelAnimationFrame(waveRaf);
    waveRaf = null;
  }
  levels.fill(0);
}

// --- stage control ----------------------------------------------------------

let currentPhase = "idle";

stage.addEventListener("click", () => {
  if (currentPhase === "recording") {
    chrome.runtime.sendMessage({ type: "CANCEL_RECORDING" }).catch(() => {});
  } else if (currentPhase === "idle" || currentPhase === "done" || currentPhase === "error") {
    chrome.runtime.sendMessage({ type: "START_RECORDING" }).catch(() => {});
  }
});

const STAGE_LABEL = {
  idle: "Ready",
  recording: "Listening",
  thinking: "Thinking",
  working: "Working",
  done: "Done",
  error: "Something went wrong",
  needs_mic: "Microphone needed",
};

const MARKS = { pending: "○", ok: "✓", failed: "✕", needs_input: "?", answered: "✓" };

function render(s) {
  if (!s) return;
  currentPhase = s.phase;

  stageLabel.textContent = STAGE_LABEL[s.phase] ?? "";

  const listening = s.phase === "recording";
  const busy = s.phase === "thinking" || s.phase === "working";

  wave.hidden = !listening;
  spinner.hidden = !busy;
  idleHint.hidden = listening || busy;

  if (listening) startWave();
  else stopWave();

  heardEl.textContent = s.transcript ? `“${s.transcript}”` : "";
  heardEl.hidden = !s.transcript;

  const spoken = s.phase === "error" ? s.error : (s.summary ?? "");
  answerEl.textContent = spoken ?? "";
  answerEl.hidden = !spoken;

  tasksEl.replaceChildren();
  // An answered task's text is already the headline reply; repeating it in the
  // list below would say the same thing twice.
  const listed = (s.tasks ?? []).filter((t) => t.status !== "answered");
  for (const task of listed) {
    const li = document.createElement("li");
    li.className = task.status;

    const mark = document.createElement("span");
    mark.className = "mark";
    mark.textContent = MARKS[task.status] ?? "○";

    const body = document.createElement("span");
    body.textContent = task.detail || task.tool.replace(/_/g, " ");

    li.append(mark, body);
    tasksEl.append(li);
  }

  reply.hidden = !s.transcript && !spoken && listed.length === 0;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "STATE") render(message.state);
  else if (message.type === "LEVEL") pushLevel(message.value);
  return false;
});

// Opening the popup IS the request to talk — the whole point is that a command
// costs one keystroke. A command already in flight is rendered instead.
chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
  if (chrome.runtime.lastError) return;
  const s = res?.state;
  render(s);
  if (!s || s.phase === "idle" || s.phase === "done" || s.phase === "error") {
    chrome.runtime.sendMessage({ type: "START_RECORDING" }).catch(() => {});
  }
});

const micBtn = document.getElementById("micBtn");
const statusEl = document.getElementById("status");
const transcriptEl = document.getElementById("transcript");
const langSelect = document.getElementById("langSelect");
const serverUrlInput = document.getElementById("serverUrl");

chrome.storage.local.get(["serverUrl", "langHint"], (data) => {
  if (data.serverUrl) serverUrlInput.value = data.serverUrl;
  if (data.langHint) langSelect.value = data.langHint;
});
serverUrlInput.addEventListener("change", () =>
  chrome.storage.local.set({ serverUrl: serverUrlInput.value })
);
langSelect.addEventListener("change", () =>
  chrome.storage.local.set({ langHint: langSelect.value })
);

let mediaRecorder;
let chunks = [];
let isRecording = false;

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  chunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
  mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
  mediaRecorder.onstop = onRecordingStopped;
  mediaRecorder.start();
  isRecording = true;
  micBtn.textContent = "Release to send";
  micBtn.classList.add("listening");
  statusEl.textContent = "Listening...";
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach((t) => {
      t.stop();
    });
  }
  isRecording = false;
  micBtn.textContent = "Hold to talk";
  micBtn.classList.remove("listening");
}

async function onRecordingStopped() {
  statusEl.textContent = "Transcribing...";
  const blob = new Blob(chunks, { type: "audio/webm" });
  const formData = new FormData();
  formData.append("audio", blob, "command.webm");
  const langHint = langSelect.value;
  if (langHint) formData.append("languageCode", langHint);

  const serverUrl = serverUrlInput.value.replace(/\/$/, "");

  try {
    const res = await fetch(`${serverUrl}/api/voice-command`, { method: "POST", body: formData });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();

    transcriptEl.textContent = data.transcript ? `"${data.transcript}"` : "";

    // Server-resolved actions (Todoist, clarify) already have a confirmation + audio.
    // Browser-side actions get dispatched to the background service worker to execute.
    const browserActions = [
      "search_web",
      "open_url",
      "switch_tab",
      "fill_form_field",
      "submit_form",
    ];
    if (browserActions.includes(data.action.tool)) {
      chrome.runtime.sendMessage({ type: "EXECUTE_ACTION", action: data.action });
      statusEl.textContent = `Doing: ${data.action.tool}`;
    } else {
      statusEl.textContent = data.confirmationText || "Done.";
      if (data.audioUrl) {
        const audio = new Audio(data.audioUrl);
        audio.play().catch(() => {});
      }
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  }
}

// Hold-to-talk interaction (mousedown/mouseup rather than click/toggle, so it
// mirrors a walkie-talkie and avoids accidentally leaving the mic hot).
micBtn.addEventListener("mousedown", startRecording);
micBtn.addEventListener("mouseup", stopRecording);
micBtn.addEventListener("mouseleave", () => {
  if (isRecording) stopRecording();
});

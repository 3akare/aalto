/**
 * Offscreen worker: owns the microphone and the speaker.
 *
 * Recording lives here rather than in the popup because the popup is destroyed
 * as soon as it loses focus - which happens the instant Aalto opens or switches
 * a tab. Playback lives here because a service worker has no DOM and therefore
 * no Audio element.
 */

let mediaRecorder = null;
let chunks = [];
let stream = null;
let player = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  switch (message.type) {
    case "START_RECORDING":
      startRecording()
        .then(() => sendResponse({ ok: true }))
        // The name matters: the background worker uses NotAllowedError to decide
        // whether to open the permission page, and err.message alone is vague.
        .catch((err) => sendResponse({ ok: false, error: err.message, name: err.name }));
      return true; // async response

    case "STOP_RECORDING":
      stopRecording()
        .then((audioBase64) => sendResponse({ ok: true, audioBase64 }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "PLAY_AUDIO":
      play(message.url)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "STOP_AUDIO":
      stopPlayback();
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});

async function startRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    throw new Error("already recording");
  }
  // Held open across commands so repeated use does not re-prompt or re-negotiate
  // the device, which adds a noticeable delay before the first syllable lands.
  if (!stream) {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  }

  chunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  mediaRecorder.start();
}

async function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state !== "recording") {
    throw new Error("not recording");
  }

  const finished = new Promise((resolve) => {
    mediaRecorder.onstop = resolve;
  });
  mediaRecorder.stop();
  await finished;

  const blob = new Blob(chunks, { type: "audio/webm" });
  chunks = [];
  if (blob.size === 0) throw new Error("no audio captured");

  // Messages cannot carry a Blob, so hand the bytes over as base64 and let the
  // service worker rebuild them for the multipart upload.
  return await blobToBase64(blob);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("could not read recorded audio"));
    reader.readAsDataURL(blob);
  });
}

async function play(url) {
  stopPlayback();
  player = new Audio(url);
  await player.play();
}

function stopPlayback() {
  if (player) {
    player.pause();
    player = null;
  }
}

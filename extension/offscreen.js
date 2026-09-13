/**
 * Offscreen worker: owns the microphone and the speaker.
 *
 * Recording lives here rather than in the popup because the popup is destroyed
 * as soon as it loses focus - which happens the instant Aalto opens or switches
 * a tab. Playback lives here because a service worker has no DOM and therefore
 * no Audio element.
 *
 * It also does the listening-for-silence, so a command ends when the speaker
 * stops talking rather than when they remember to release a button.
 */

const SILENCE_RMS = 0.012; // below this counts as room tone rather than speech
const SILENCE_HOLD_MS = 1100; // quiet for this long after speech -> commit
const LEAD_IN_GRACE_MS = 4000; // wait at least this long for someone to start
const MAX_UTTERANCE_MS = 25_000; // hard stop; Intron's session cap is far higher
const LEVEL_INTERVAL_MS = 60; // waveform refresh sent to the popup

let mediaRecorder = null;
let chunks = [];
let stream = null;
let player = null;

let audioCtx = null;
let analyser = null;
let levelTimer = null;
let startedAt = 0;
let lastVoiceAt = 0;
let heardVoice = false;
let autoStopTimer = null;

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

  startedAt = Date.now();
  lastVoiceAt = 0;
  heardVoice = false;
  startMetering();
}

/**
 * Watch the input level: drive the popup's waveform, and decide when the speaker
 * has finished. Ending on silence rather than on a button release is what lets
 * the whole interaction be "press the shortcut, talk, done".
 */
function startMetering() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.6;
  audioCtx.createMediaStreamSource(stream).connect(analyser);

  const buf = new Float32Array(analyser.fftSize);

  levelTimer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);

    // Nobody may be listening; that is not an error.
    chrome.runtime.sendMessage({ type: "LEVEL", value: rms }).catch(() => {});

    const now = Date.now();
    if (rms >= SILENCE_RMS) {
      heardVoice = true;
      lastVoiceAt = now;
    }

    const elapsed = now - startedAt;
    const quietFor = lastVoiceAt ? now - lastVoiceAt : 0;

    if (heardVoice && quietFor >= SILENCE_HOLD_MS) {
      requestAutoStop("silence");
    } else if (!heardVoice && elapsed >= LEAD_IN_GRACE_MS) {
      // Opened by accident, or the mic is dead - don't sit recording room tone.
      requestAutoStop("nothing heard");
    } else if (elapsed >= MAX_UTTERANCE_MS) {
      requestAutoStop("max length");
    }
  }, LEVEL_INTERVAL_MS);
}

function stopMetering() {
  clearInterval(levelTimer);
  levelTimer = null;
  if (analyser) {
    analyser.disconnect();
    analyser = null;
  }
}

/** Hand the decision to the background worker so one path drives the whole flow. */
function requestAutoStop(reason) {
  if (autoStopTimer) return;
  autoStopTimer = setTimeout(() => {
    autoStopTimer = null;
  }, 500);
  stopMetering();
  chrome.runtime.sendMessage({ type: "AUTO_STOP", reason, heardVoice })?.catch?.(() => {});
}

async function stopRecording() {
  stopMetering();
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

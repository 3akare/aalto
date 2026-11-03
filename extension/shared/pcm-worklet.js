/**
 * Captures microphone PCM, resamples to 24 kHz, and hands up whole frames.
 *
 * Resampling here rather than forcing `new AudioContext({sampleRate: 24000})`
 * is the portable choice: Firefox quietly drops echo cancellation when the
 * context rate does not match the device, and Safari garbles audio outright.
 * Echo cancellation is what stops the agent interrupting its own voice.
 *
 * Framing is here too - a message per 128-sample quantum is ~190 a second,
 * enough to stall the receiving thread. 2048 samples is about 85 ms.
 */

const TARGET_RATE = 24000;
const FRAME_SAMPLES = 2048;

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    // `sampleRate` is a worklet global: the context's real rate.
    this.ratio = sampleRate / TARGET_RATE;
    this.readPos = 0; // fractional, carried across quanta so no click at the seam
    // One buffer for the life of the node: process() runs ~375 times a second on
    // the real-time thread, and allocating there invites garbage-collection
    // pauses, which are audible as dropouts. It holds the samples the last
    // quantum could not consume, followed by the current one.
    this.buffer = new Float32Array(1024);
    this.buffered = 0;
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    // A disconnected or silent-but-live input yields an empty array rather than
    // zeros; returning true keeps the node alive for when audio resumes.
    if (!channel || channel.length === 0) return true;

    // Join the leftover so interpolation looks across the quantum boundary.
    if (this.buffered + channel.length > this.buffer.length) {
      const grown = new Float32Array((this.buffered + channel.length) * 2);
      grown.set(this.buffer.subarray(0, this.buffered));
      this.buffer = grown;
    }
    this.buffer.set(channel, this.buffered);
    const length = this.buffered + channel.length;
    const buffer = this.buffer;

    let pos = this.readPos;
    while (pos < length - 1) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const sample = buffer[i] * (1 - frac) + buffer[i + 1] * frac;

      const clamped = Math.max(-1, Math.min(1, sample));
      this.frame[this.filled++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;

      if (this.filled === FRAME_SAMPLES) {
        // Transferred, not copied: the receiver owns it, so a fresh frame is
        // the one allocation that cannot be avoided - once every ~85 ms.
        const out = this.frame;
        this.port.postMessage(out, [out.buffer]);
        this.frame = new Int16Array(FRAME_SAMPLES);
        this.filled = 0;
      }

      pos += this.ratio;
    }

    // At high device rates one step can overshoot the buffer; the overshoot is
    // carried in readPos so the next quantum starts at the right sample.
    const consumed = Math.min(Math.floor(pos), length);
    buffer.copyWithin(0, consumed, length);
    this.buffered = length - consumed;
    this.readPos = pos - consumed;
    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);

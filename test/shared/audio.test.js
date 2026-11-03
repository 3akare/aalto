import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Speaker } from "../../shared/speaker.js";

// --- the capture worklet ------------------------------------------------------

async function loadWorklet(rate) {
  let Processor;
  vi.stubGlobal("sampleRate", rate);
  vi.stubGlobal(
    "AudioWorkletProcessor",
    class {
      constructor() {
        this.port = {
          posted: [],
          postMessage(msg) {
            this.posted.push(msg);
          },
        };
      }
    }
  );
  vi.stubGlobal("registerProcessor", (_name, cls) => {
    Processor = cls;
  });
  vi.resetModules();
  await import("../../shared/pcm-worklet.js");
  return new Processor();
}

/** Feed `seconds` of a ramp in 128-sample quanta, as the audio thread would. */
function feed(proc, rate, seconds, fill = (i) => ((i % 200) - 100) / 100) {
  let n = 0;
  for (let q = 0; q < (rate * seconds) / 128; q++) {
    const quantum = new Float32Array(128);
    for (let i = 0; i < 128; i++) quantum[i] = fill(n++);
    expect(proc.process([[quantum]])).toBe(true);
  }
  return n;
}

describe("pcm-capture worklet", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([48_000, 44_100, 16_000, 24_000, 96_000, 192_000, 88_200])(
    "resamples %i Hz to 24 kHz in whole 2048-sample frames",
    async (rate) => {
      const proc = await loadWorklet(rate);
      const fed = feed(proc, rate, 1);
      const frames = proc.port.posted;
      for (const f of frames) {
        expect(f).toBeInstanceOf(Int16Array);
        expect(f.length).toBe(2048);
      }
      // Output tracks input at the 24 kHz ratio, give or take the
      // interpolation tail carried into the next quantum.
      const out = frames.length * 2048 + proc.filled;
      expect(Math.abs(out - (fed * 24_000) / rate)).toBeLessThanOrEqual(2);
    }
  );

  it("is continuous across quantum boundaries", async () => {
    const proc = await loadWorklet(48_000);
    // A slow ramp: any seam glitch shows up as a jump between neighbours.
    feed(proc, 48_000, 0.5, (i) => Math.sin(i / 400));
    const samples = proc.port.posted.flatMap((f) => Array.from(f));
    let worst = 0;
    for (let i = 1; i < samples.length; i++)
      worst = Math.max(worst, Math.abs(samples[i] - samples[i - 1]));
    expect(worst).toBeLessThan(200);
  });

  it("clamps out-of-range input instead of wrapping", async () => {
    const proc = await loadWorklet(24_000);
    feed(proc, 24_000, 0.1, (i) => (i % 2 ? 4 : -4));
    const samples = proc.port.posted.flatMap((f) => Array.from(f));
    expect(Math.max(...samples)).toBe(32767);
    expect(Math.min(...samples)).toBe(-32768);
  });

  it("survives an empty or missing input and stays alive", async () => {
    const proc = await loadWorklet(48_000);
    expect(proc.process([[]])).toBe(true);
    expect(proc.process([])).toBe(true);
  });
});

// --- the speaker ---------------------------------------------------------------

class FakeSource {
  constructor(ctx) {
    this.ctx = ctx;
    this.stopped = false;
  }
  connect() {}
  start(at) {
    this.startedAt = at;
    this.ctx.sources.push(this);
  }
  stop() {
    this.stopped = true;
  }
  finish() {
    this.onended?.();
  }
}

class FakeContext {
  constructor() {
    this.currentTime = 10;
    this.destination = {};
    this.sources = [];
  }
  createBuffer(_channels, length, rate) {
    const data = new Float32Array(length);
    return { duration: length / rate, getChannelData: () => data };
  }
  createBufferSource() {
    return new FakeSource(this);
  }
}

describe("Speaker", () => {
  let ctx;
  let speaker;
  beforeEach(() => {
    ctx = new FakeContext();
    speaker = new Speaker(ctx);
  });

  it("schedules chunks end to end on the audio clock", () => {
    speaker.push(new Int16Array(2400)); // 100 ms
    speaker.push(new Int16Array(2400));
    const [a, b] = ctx.sources;
    expect(a.startedAt).toBeCloseTo(10.08);
    expect(b.startedAt).toBeCloseTo(10.18);
  });

  it("ignores empty chunks", () => {
    speaker.push(new Int16Array(0));
    expect(ctx.sources).toHaveLength(0);
  });

  it("reports idle only once every scheduled chunk has ended", () => {
    speaker.onIdle = vi.fn();
    speaker.push(new Int16Array(10));
    speaker.push(new Int16Array(10));
    ctx.sources[0].finish();
    expect(speaker.onIdle).not.toHaveBeenCalled();
    ctx.sources[1].finish();
    expect(speaker.onIdle).toHaveBeenCalledOnce();
    expect(speaker.speaking).toBe(false);
  });

  it("stop() cuts off everything scheduled, not just what is playing", () => {
    speaker.push(new Int16Array(2400));
    speaker.push(new Int16Array(2400));
    speaker.stop();
    expect(ctx.sources.every((s) => s.stopped)).toBe(true);
    expect(speaker.speaking).toBe(false);
    // The next reply starts fresh rather than queued behind the cut one.
    speaker.push(new Int16Array(10));
    expect(ctx.sources.at(-1).startedAt).toBeCloseTo(10.08);
  });

  it("converts PCM16 to the -1..1 float range", () => {
    let channel;
    ctx.createBuffer = (_c, length, rate) => {
      channel = new Float32Array(length);
      return { duration: length / rate, getChannelData: () => channel };
    };
    speaker.push(new Int16Array([-32768, 0, 16384]));
    expect(Array.from(channel)).toEqual([-1, 0, 0.5]);
  });
});

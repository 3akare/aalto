import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mic } from "../../web/public/demo/mic.js";

let contexts;
let track;

beforeEach(() => {
  contexts = [];
  track = { stop: vi.fn() };
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) },
  });
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        this.state = "running";
        this.audioWorklet = { addModule: vi.fn(async () => {}) };
        this.close = vi.fn(async () => {
          this.state = "closed";
        });
        contexts.push(this);
      }
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
    }
  );
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      constructor() {
        this.port = {};
        this.disconnect = vi.fn();
      }
    }
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("Mic", () => {
  it("releases the device and closes its AudioContext on stop", async () => {
    const mic = new Mic(() => {});
    await mic.start();
    mic.stop();
    expect(track.stop).toHaveBeenCalled();
    expect(contexts[0].close).toHaveBeenCalled();
  });

  it("does not accumulate contexts across sessions", async () => {
    for (let i = 0; i < 8; i++) {
      const mic = new Mic(() => {});
      await mic.start();
      mic.stop();
    }
    expect(contexts.filter((c) => c.state !== "closed")).toHaveLength(0);
  });

  it("is safe to stop twice, or before starting", () => {
    const mic = new Mic(() => {});
    expect(() => {
      mic.stop();
      mic.stop();
    }).not.toThrow();
  });

  it("explains a blocked microphone in words", async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValue(
      Object.assign(new Error("Permission denied"), { name: "NotAllowedError" })
    );
    await expect(new Mic(() => {}).start()).rejects.toThrow(/microphone was blocked/);
  });
});

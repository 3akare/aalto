// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXTENSION_ID, OFFSCREEN } from "./fake-chrome.js";

let listener;
let tracks;
let sockets;

class FakeSocket {
  static OPEN = 1;
  constructor() {
    this.readyState = 0;
    this.handlers = {};
    sockets.push(this);
    // Opens and becomes ready on the next tick, like a fast handshake.
    setTimeout(() => {
      this.readyState = 1;
      this.handlers.open?.forEach((f) => f());
      this.handlers.message?.forEach((f) => f({ data: '{"type":"session.ready"}' }));
    }, 0);
  }
  addEventListener(type, fn) {
    (this.handlers[type] ??= new Set()).add(fn);
  }
  removeEventListener(type, fn) {
    this.handlers[type]?.delete(fn);
  }
  send(data) {
    if (JSON.parse(data).type === "session.end") {
      setTimeout(
        () => this.handlers.message?.forEach((f) => f({ data: '{"type":"session.ended"}' })),
        0
      );
    }
  }
  close() {
    this.readyState = 3;
  }
}

beforeEach(async () => {
  tracks = [];
  sockets = [];
  vi.stubGlobal("chrome", {
    runtime: {
      id: EXTENSION_ID,
      onMessage: { addListener: (fn) => (listener = fn) },
      sendMessage: vi.fn(async () => ({ ok: true })),
    },
  });
  vi.stubGlobal("WebSocket", FakeSocket);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        const track = { stop: vi.fn(), readyState: "live" };
        track.stop.mockImplementation(() => (track.readyState = "ended"));
        tracks.push(track);
        return { getTracks: () => [track] };
      }),
    },
  });
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      audioWorklet = { addModule: vi.fn(async () => {}) };
      destination = {};
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      suspend = vi.fn(async () => (this.state = "suspended"));
      resume = vi.fn(async () => (this.state = "running"));
    }
  );
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      port = {};
      disconnect() {}
    }
  );
  vi.resetModules();
  await import("../../extension/offscreen.js");
});
afterEach(() => vi.unstubAllGlobals());

function send(message, sender = { id: EXTENSION_ID, url: OFFSCREEN.url }) {
  return new Promise((resolve) => {
    const keepOpen = listener({ target: "offscreen", ...message }, sender, resolve);
    if (!keepOpen) setTimeout(() => resolve(undefined), 0);
  });
}

const START = { type: "START_SESSION", config: { token: "t", tools: [], greeting: null } };

describe("offscreen document", () => {
  it("releases the microphone when the session ends", async () => {
    expect(await send(START)).toEqual({ ok: true });
    expect(tracks[0].readyState).toBe("live");
    expect(await send({ type: "END_SESSION" })).toEqual({ ok: true });
    expect(tracks.every((t) => t.readyState === "ended")).toBe(true);
  });

  it("can start again after ending", async () => {
    await send(START);
    await send({ type: "END_SESSION" });
    expect(await send(START)).toEqual({ ok: true });
  });

  it("refuses a second start while the first is still connecting", async () => {
    const [a, b] = await Promise.all([send(START), send(START)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(sockets).toHaveLength(1);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
  });

  it("ignores messages from a web page", async () => {
    const fromTab = { id: EXTENSION_ID, tab: { id: 1 }, url: "https://evil.example" };
    expect(await send(START, fromTab)).toBeUndefined();
    expect(sockets).toHaveLength(0);
  });

  it("passes the error name through so a blocked mic opens the permission page", async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValue(
      Object.assign(new Error("Permission dismissed"), { name: "NotAllowedError" })
    );
    expect(await send(START)).toMatchObject({ ok: false, name: "NotAllowedError" });
  });

  it("copies text, coercing a non-string", async () => {
    document.execCommand = vi.fn(() => true);
    expect(await send({ type: "COPY", text: 42 })).toEqual({ ok: true });
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });
});

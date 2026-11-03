import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSession } from "../../shared/agent-session.js";

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static last = null;

  constructor(url) {
    this.url = String(url);
    this.readyState = FakeSocket.CONNECTING;
    this.sent = [];
    this.listeners = new Map();
    FakeSocket.last = this;
  }
  addEventListener(type, fn, opts) {
    const set = this.listeners.get(type) ?? new Set();
    set.add({ fn, once: opts?.once });
    this.listeners.set(type, set);
  }
  removeEventListener(type, fn) {
    for (const entry of this.listeners.get(type) ?? []) {
      if (entry.fn === fn) this.listeners.get(type).delete(entry);
    }
  }
  count(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
  emit(type, event = {}) {
    for (const entry of [...(this.listeners.get(type) ?? [])]) {
      if (entry.once) this.listeners.get(type).delete(entry);
      entry.fn(event);
    }
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
    this.emit("close", { code: 1000 });
  }
  // test helpers
  open() {
    this.readyState = FakeSocket.OPEN;
    this.emit("open");
  }
  frame(obj) {
    this.emit("message", { data: JSON.stringify(obj) });
  }
  sentOfType(type) {
    return this.sent.filter((f) => f.type === type);
  }
}

beforeEach(() => vi.stubGlobal("WebSocket", FakeSocket));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function makeSession(overrides = {}) {
  const events = [];
  const session = new AgentSession({
    token: "tok",
    runTool: async (name) => `ran ${name}`,
    onEvent: (e) => events.push(e),
    ...overrides,
  });
  return { session, events };
}

async function connected(overrides) {
  const made = makeSession(overrides);
  const pending = made.session.connect();
  const socket = FakeSocket.last;
  socket.open();
  socket.frame({ type: "session.ready" });
  await pending;
  return { ...made, socket };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("connect", () => {
  it("puts the token on the URL, sends session.update on open, resolves on ready", async () => {
    const { socket, session } = await connected();
    expect(new URL(socket.url).searchParams.get("token")).toBe("tok");
    expect(socket.sent[0].type).toBe("session.update");
    expect(session.ready).toBe(true);
  });

  it("rejects when the socket closes before session.ready", async () => {
    const { session } = makeSession();
    const pending = session.connect();
    FakeSocket.last.open();
    FakeSocket.last.close();
    await expect(pending).rejects.toThrow(/closed the session before it started/);
  });

  it("rejects when the handshake errors", async () => {
    const { session } = makeSession();
    const pending = session.connect();
    FakeSocket.last.emit("error");
    await expect(pending).rejects.toThrow(/couldn't open a session/);
  });

  it("times out instead of hanging when session.ready never arrives", async () => {
    vi.useFakeTimers();
    const { session } = makeSession();
    const pending = session.connect();
    FakeSocket.last.open();
    const assertion = expect(pending).rejects.toThrow(/didn't start the session in time/);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(FakeSocket.last.readyState).toBe(FakeSocket.CLOSED);
  });
});

describe("tool results wait for reply.done", () => {
  it("holds a result until the reply is done, then sends it", async () => {
    const { socket } = await connected();
    socket.frame({ type: "tool.call", call_id: "c1", name: "get_context", arguments: {} });
    await tick();
    expect(socket.sentOfType("tool.result")).toHaveLength(0);

    socket.frame({ type: "reply.done" });
    expect(socket.sentOfType("tool.result")).toEqual([
      { type: "tool.result", call_id: "c1", result: "ran get_context" },
    ]);
  });

  it("sends at once when the session is already idle", async () => {
    let release;
    const { socket } = await connected({ runTool: () => new Promise((r) => (release = r)) });
    socket.frame({ type: "tool.call", call_id: "c1", name: "x" });
    socket.frame({ type: "reply.done" });
    release("late");
    await tick();
    expect(socket.sentOfType("tool.result")[0].result).toBe("late");
  });

  it("turns a thrown error into a sentence the agent can say", async () => {
    const { socket } = await connected({
      runTool: async () => {
        throw new Error("no page");
      },
    });
    socket.frame({ type: "tool.call", call_id: "c1", name: "x" });
    await tick();
    socket.frame({ type: "reply.done" });
    expect(socket.sentOfType("tool.result")[0].result).toBe("That failed: no page");
  });

  it("drops pending results when the reply was interrupted", async () => {
    const { socket } = await connected();
    socket.frame({ type: "tool.call", call_id: "c1", name: "x" });
    await tick();
    socket.frame({ type: "reply.done", status: "interrupted" });
    socket.frame({ type: "reply.done" });
    expect(socket.sentOfType("tool.result")).toHaveLength(0);
  });

  it("sends nothing for a tool that finishes after the session ended", async () => {
    let release;
    const { socket, session } = await connected({
      runTool: () => new Promise((r) => (release = r)),
    });
    socket.frame({ type: "tool.call", call_id: "c1", name: "x" });
    const ending = session.end();
    socket.frame({ type: "session.ended" });
    await ending;
    release("too late");
    await tick();
    expect(socket.sentOfType("tool.result")).toHaveLength(0);
    expect(session.pendingResults).toHaveLength(0);
  });
});

describe("barge-in and audio", () => {
  it("interrupts playback on input.speech.started", async () => {
    const onInterrupt = vi.fn();
    const { socket } = await connected({ onInterrupt });
    socket.frame({ type: "input.speech.started" });
    expect(onInterrupt).toHaveBeenCalledOnce();
  });

  it("round-trips PCM through base64 both ways", async () => {
    const onAudio = vi.fn();
    const { socket, session } = await connected({ onAudio });
    const pcm = new Int16Array([0, 1, -1, 32767, -32768]);
    session.sendAudio(pcm);
    const { audio } = socket.sentOfType("input.audio")[0];
    socket.frame({ type: "reply.audio", data: audio });
    expect(Array.from(onAudio.mock.calls[0][0])).toEqual(Array.from(pcm));
  });

  it("does not send audio before the session is ready", () => {
    const { session } = makeSession();
    session.connect().catch(() => {});
    FakeSocket.last.open();
    session.sendAudio(new Int16Array(4));
    expect(FakeSocket.last.sentOfType("input.audio")).toHaveLength(0);
  });

  it("ignores malformed frames", async () => {
    const { socket, events } = await connected();
    const before = events.length;
    socket.emit("message", { data: "{not json" });
    expect(events.length).toBe(before);
  });
});

describe("end", () => {
  it("says session.end, waits for session.ended, and closes", async () => {
    const { socket, session } = await connected();
    const ending = session.end();
    expect(socket.sentOfType("session.end")).toHaveLength(1);
    socket.frame({ type: "session.ended" });
    await ending;
    expect(socket.readyState).toBe(FakeSocket.CLOSED);
  });

  it("does not report a deliberate end as a dropped session", async () => {
    const { socket, session, events } = await connected();
    const ending = session.end();
    socket.frame({ type: "session.ended" });
    await ending;
    expect(events.some((e) => e.type === "session.dropped")).toBe(false);
  });

  it("leaves no message listener of its own behind", async () => {
    const { socket, session } = await connected();
    const before = socket.count("message");
    const ending = session.end();
    socket.frame({ type: "session.ended" });
    await ending;
    expect(socket.count("message")).toBe(before);
  });

  it("gives up waiting after a timeout", async () => {
    vi.useFakeTimers();
    const { socket, session } = await connected();
    const ending = session.end();
    await vi.advanceTimersByTimeAsync(2000);
    await ending;
    expect(socket.readyState).toBe(FakeSocket.CLOSED);
  });

  it("reports a socket that drops mid-session", async () => {
    const { socket, events } = await connected();
    socket.close();
    expect(events.at(-1)).toEqual({ type: "session.dropped" });
  });
});

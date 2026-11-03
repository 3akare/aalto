// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXTENSION_ID } from "./fake-chrome.js";

const root = resolve(import.meta.dirname, "../../extension");
const bodyOf = (file) => {
  const html = readFileSync(resolve(root, file), "utf8");
  return html
    .slice(html.indexOf("<body"), html.lastIndexOf("</body>"))
    .replace(/<script[\s\S]*?<\/script>/g, "");
};
/** Run a classic script the way the page would, sharing the window's globals. */
// biome-ignore lint/security/noGlobalEval: evaluates the extension's own source files, as a <script> tag would
const runScript = (file) => window.eval(readFileSync(resolve(root, file), "utf8"));

describe("permission page", () => {
  beforeEach(() => {
    document.body.innerHTML = bodyOf("permission.html");
  });

  it("describes when it listens accurately", () => {
    expect(document.body.textContent).not.toMatch(/hold the talk button/);
    expect(document.body.textContent).toMatch(/only while a session is on/);
  });

  it("announces its status to screen readers", () => {
    expect(document.getElementById("status").getAttribute("role")).toBe("status");
  });

  it("shows an error message as text, never as markup", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw Object.assign(new Error('<img src=x onerror="alert(1)">'), { name: "AbortError" });
        }),
      },
    });
    runScript("permission.js");
    document.getElementById("grant").click();
    await vi.waitFor(() =>
      expect(document.getElementById("status").textContent).toMatch(/Could not/)
    );
    expect(document.querySelector("#status img")).toBeNull();
    expect(document.getElementById("status").textContent).toContain("<img src=x");
  });

  it("explains a block with steps", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
        }),
      },
    });
    runScript("permission.js");
    document.getElementById("grant").click();
    await vi.waitFor(() => expect(document.querySelectorAll("#status li")).toHaveLength(3));
  });
});

describe("side panel", () => {
  let store;
  let sent;
  let onMessage;

  beforeEach(() => {
    document.body.innerHTML = bodyOf("sidepanel.html");
    store = {};
    sent = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
      }
    );
    vi.stubGlobal("requestAnimationFrame", () => 1);
    HTMLCanvasElement.prototype.getContext = () => ({
      clearRect() {},
      beginPath() {},
      roundRect() {},
      fill() {},
    });
    vi.stubGlobal("chrome", {
      runtime: {
        id: EXTENSION_ID,
        connect: () => ({ postMessage() {}, onDisconnect: { addListener() {} } }),
        onMessage: { addListener: (fn) => (onMessage = fn) },
        sendMessage: (msg, cb) => {
          sent.push(msg);
          cb?.({});
        },
        lastError: undefined,
      },
      windows: { getCurrent: async () => ({ id: 1 }) },
      storage: {
        local: {
          get: (keys, cb) =>
            cb(Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]))),
          set: vi.fn((obj) => Object.assign(store, obj)),
        },
      },
      commands: { getAll: (cb) => cb([{ name: "start-listening", shortcut: "Alt+A" }]) },
      tabs: { create: vi.fn() },
    });
    runScript("icons.js");
    runScript("sidepanel.js");
  });

  function setEndpoint(value) {
    const input = document.getElementById("workerUrl");
    input.value = value;
    input.dispatchEvent(new Event("change"));
  }

  it.each(["http://evil.example", "not a url", "javascript:alert(1)"])(
    "refuses to save the endpoint %j and says why",
    (value) => {
      setEndpoint(value);
      expect(store.workerUrl).toBeUndefined();
      expect(document.getElementById("workerUrl").getAttribute("aria-invalid")).toBe("true");
      expect(document.getElementById("workerNote").textContent).toMatch(/https:\/\//);
    }
  );

  it("saves a valid endpoint, a local one, or clears it", () => {
    setEndpoint("https://my-worker.example.workers.dev/");
    expect(store.workerUrl).toBe("https://my-worker.example.workers.dev");
    setEndpoint("http://localhost:8787");
    expect(store.workerUrl).toBe("http://localhost:8787");
    setEndpoint("");
    expect(store.workerUrl).toBe("");
    expect(document.getElementById("workerUrl").getAttribute("aria-invalid")).toBe("false");
  });

  it("announces status changes", () => {
    const status = document.getElementById("status");
    expect(status.getAttribute("role")).toBe("status");
    onMessage({ type: "STATE", state: { phase: "listening", turns: [] } });
    expect(document.getElementById("statusText").textContent).toBe("Listening");
  });

  it("renders transcript text as text", () => {
    onMessage({
      type: "STATE",
      state: { phase: "idle", turns: [{ id: "1", role: "user", text: "<b>hi</b>" }] },
    });
    const msg = document.querySelector("#feed .msg.user");
    expect(msg.textContent).toBe("<b>hi</b>");
    expect(msg.querySelector("b")).toBeNull();
  });

  it("shows which credentials are in use", () => {
    const key = document.getElementById("assemblyKey");
    key.value = "  abc  ";
    key.dispatchEvent(new Event("change"));
    expect(store.assemblyKey).toBe("abc");
    expect(document.getElementById("modeChip").textContent).toBe("Your key");
  });
});

/**
 * An in-memory stand-in for the chrome.* APIs background.js touches. Tabs are
 * plain objects; the content script is a function the test supplies.
 */
import { vi } from "vitest";

export const EXTENSION_ID = "kpfmcjoapodehdolgeohbpbickdmejko";

function event() {
  const listeners = new Set();
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    hasListeners: () => listeners.size > 0,
    count: () => listeners.size,
    emit: (...args) => [...listeners].map((fn) => fn(...args)),
  };
}

export function fakeChrome({ contentScript = () => ({ ok: true, detail: "done" }) } = {}) {
  const store = {};
  let nextTabId = 100;
  const tabs = [];
  const offscreen = { open: false, reply: { ok: true } };

  const chrome = {
    _tabs: tabs,
    _store: store,
    _offscreen: offscreen,
    _contentScript: contentScript,
    runtime: {
      id: EXTENSION_ID,
      getURL: (p) => `chrome-extension://${EXTENSION_ID}/${p}`,
      onMessage: event(),
      onConnect: event(),
      getContexts: vi.fn(async () => (offscreen.open ? [{}] : [])),
      sendMessage: vi.fn(async (message) => {
        if (message.target === "offscreen") return offscreen.reply;
        return undefined;
      }),
    },
    storage: {
      local: {
        get: vi.fn(async (keys) => {
          const list = typeof keys === "string" ? [keys] : (keys ?? Object.keys(store));
          return Object.fromEntries(
            list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])])
          );
        }),
        set: vi.fn(async (obj) => Object.assign(store, structuredClone(obj))),
        remove: vi.fn(async (key) => {
          delete store[key];
        }),
      },
    },
    sidePanel: { setPanelBehavior: vi.fn(async () => {}), open: vi.fn(async () => {}) },
    commands: { onCommand: event() },
    offscreen: {
      createDocument: vi.fn(async () => {
        offscreen.open = true;
      }),
    },
    scripting: { executeScript: vi.fn(async () => {}) },
    tabs: {
      onRemoved: event(),
      onUpdated: event(),
      query: vi.fn(async ({ active, url } = {}) =>
        tabs.filter(
          (t) => (active == null || t.active === active) && (url == null || t.url === url)
        )
      ),
      get: vi.fn(async (id) => {
        const tab = tabs.find((t) => t.id === id);
        if (!tab) throw new Error(`No tab with id: ${id}`);
        return { ...tab };
      }),
      create: vi.fn(async ({ url, active = true }) => {
        const tab = {
          id: nextTabId++,
          url,
          title: url,
          active,
          index: tabs.length,
          status: "complete",
        };
        if (active) for (const t of tabs) t.active = false;
        tabs.push(tab);
        return { ...tab };
      }),
      update: vi.fn(async (id, { active }) => {
        if (active) for (const t of tabs) t.active = t.id === id;
        return tabs.find((t) => t.id === id);
      }),
      remove: vi.fn(async (ids) => {
        for (const id of [ids].flat()) {
          const i = tabs.findIndex((t) => t.id === id);
          if (i !== -1) tabs.splice(i, 1);
          chrome.tabs.onRemoved.emit(id, {});
        }
      }),
      sendMessage: vi.fn(async (tabId, message) => chrome._contentScript(message, tabId)),
    },
  };
  return chrome;
}

/** Open a tab the user is looking at, without going through the extension. */
export function openTab(
  chrome,
  { url = "https://example.com/form", title = "Form", active = true } = {}
) {
  if (active) for (const t of chrome._tabs) t.active = false;
  const tab = {
    id: 1 + chrome._tabs.length,
    url,
    title,
    active,
    index: chrome._tabs.length,
    status: "complete",
  };
  chrome._tabs.push(tab);
  return tab;
}

/** Deliver a runtime message to background.js from a given sender. */
export function sendFrom(chrome, sender, message) {
  return new Promise((resolve) => {
    let answered = false;
    const results = chrome.runtime.onMessage.emit(message, sender, (reply) => {
      answered = true;
      resolve(reply);
    });
    // A listener that returns false will never answer.
    if (!answered && results.every((r) => r !== true)) resolve(undefined);
  });
}

export const OFFSCREEN = {
  id: EXTENSION_ID,
  url: `chrome-extension://${EXTENSION_ID}/offscreen.html`,
};
export const PANEL = { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/sidepanel.html` };

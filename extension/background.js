chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "EXECUTE_ACTION") {
    executeAction(message.action).catch((err) => console.error("[Aalto] action failed:", err));
  }
  return false;
});

async function executeAction(action) {
  switch (action.tool) {
    case "search_web":
      return chrome.tabs.create({
        url: `https://www.google.com/search?q=${encodeURIComponent(action.input.query)}`,
      });

    case "open_url":
      return chrome.tabs.create({ url: normalizeUrl(action.input.url) });

    case "switch_tab":
      return switchTab(action.input.description);

    case "fill_form_field":
    case "submit_form": {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) return;
      return chrome.tabs.sendMessage(activeTab.id, { type: "FORM_ACTION", action });
    }

    default:
      console.warn("[Aalto] Unknown browser action:", action.tool);
  }
}

function normalizeUrl(url) {
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
}

async function switchTab(description) {
  const desc = description.toLowerCase();
  const tabs = await chrome.tabs.query({});

  if (desc.includes("next")) {
    return cycleTab(tabs, 1);
  }
  if (desc.includes("previous") || desc.includes("last") || desc.includes("back")) {
    return cycleTab(tabs, -1);
  }

  // Otherwise match by title or URL containing the description.
  const match = tabs.find(
    (t) => t.title?.toLowerCase().includes(desc) || t.url?.toLowerCase().includes(desc)
  );
  if (match?.id) {
    return chrome.tabs.update(match.id, { active: true });
  }
  console.warn(`[Aalto] No tab matched "${description}"`);
}

async function cycleTab(tabs, direction) {
  const active = tabs.find((t) => t.active);
  if (!active) return;
  const sorted = tabs.sort((a, b) => a.index - b.index);
  const currentIdx = sorted.findIndex((t) => t.id === active.id);
  const nextIdx = (currentIdx + direction + sorted.length) % sorted.length;
  return chrome.tabs.update(sorted[nextIdx].id, { active: true });
}

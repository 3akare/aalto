// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A path, not new URL(): happy-dom replaces URL with one that refuses file:.
const html = readFileSync(resolve(import.meta.dirname, "../../web/public/index.html"), "utf8");

let runTool;
let resetGuard;
let sandbox;

beforeAll(async () => {
  // The demo's real markup, so the guards are tested against the form people use.
  document.body.innerHTML = html
    .slice(html.indexOf("<body"), html.lastIndexOf("</body>"))
    .replace(/<script[\s\S]*?<\/script>/g, "");
  Element.prototype.scrollIntoView = vi.fn();
  ({ runTool, resetGuard } = await import("../../web/public/demo/tool-executor.js"));
  sandbox = await import("../../web/public/demo/sandbox/sandbox.js");
});

beforeEach(() => {
  resetGuard();
  sandbox.show("form");
  for (const el of document.querySelectorAll('[data-page="form"] input')) {
    if (el.type === "radio" || el.type === "checkbox") el.checked = false;
    else el.value = "";
  }
});

const fieldLabels = () => sandbox.collectFields().map((f) => f.label);

describe("demo: the read-back guard", () => {
  it("refuses to submit a form that has not been read back", async () => {
    await expect(runTool("submit_form", {})).rejects.toThrow(/haven't read this form back/);
  });

  it("submits once it has been read back", async () => {
    await runTool("fill_field", { label: fieldLabels()[0], value: "Dana Whitfield" });
    const review = await runTool("review_form", {});
    expect(review).toMatch(/^Here's what the form says\./);
    expect(await runTool("submit_form", {})).toBe("submitted it");
  });

  it("refuses again when a field changes after the read-back", async () => {
    await runTool("review_form", {});
    await runTool("fill_field", { label: fieldLabels()[0], value: "Changed" });
    await expect(runTool("submit_form", {})).rejects.toThrow(/haven't read this form back/);
  });

  it("says blank out loud for empty fields", async () => {
    expect(await runTool("review_form", {})).toMatch(/: blank/);
  });
});

describe("demo: the never-guess guard", () => {
  it("refuses a value that matches no option", async () => {
    const choice = sandbox.collectFields().find((f) => {
      const outcome = f.write("zzz-not-an-option");
      return !outcome.ok;
    });
    expect(choice).toBeDefined();
  });

  it("refuses a label that matches no field", async () => {
    await expect(runTool("fill_field", { label: "favourite planet", value: "x" })).rejects.toThrow(
      /nothing on this page matches/
    );
  });
});

describe("demo: tabs", () => {
  it("closes only the tabs that match what was said", async () => {
    await runTool("open_url", { url: "https://news.example.com" });
    await runTool("search_web", { query: "weather in leeds" });
    expect(await runTool("close_tabs", { description: "the weather search" })).toBe("closed 1 tab");
    expect(sandbox.openedTabs()).toEqual(["https://news.example.com"]);
  });

  it("closes everything it opened when asked for the tabs it opened", async () => {
    await runTool("open_url", { url: "https://a.example" });
    await runTool("open_url", { url: "https://b.example" });
    await runTool("close_tabs", { description: "the tabs you opened" });
    expect(sandbox.openedTabs()).toEqual([]);
  });

  it("switches tabs by id and by description", async () => {
    expect(await runTool("switch_tab", { tab_id: 1 })).toMatch(/^switched to \[tab 1\]/);
    expect(await runTool("switch_tab", { description: "the form" })).toMatch(/switched to/);
    await expect(runTool("switch_tab", { tab_id: 99 })).rejects.toThrow(/nothing open matches/);
  });
});

describe("demo: unknown tools", () => {
  it("names the tool it cannot run", async () => {
    await expect(runTool("format_disk", {})).rejects.toThrow(/format_disk isn't available/);
  });
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findOnPage, goToSection, scrollPage } from "../../shared/page-nav.js";

/** happy-dom has no CSS Custom Highlight API; a recording stand-in. */
class FakeHighlight {
  constructor(...ranges) {
    this.ranges = ranges;
  }
}

beforeEach(() => {
  vi.stubGlobal("Highlight", FakeHighlight);
  vi.stubGlobal("CSS", { escape: (s) => s, highlights: new Map() });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.getElementById("aalto-mark-styles")?.remove();
  if (!document.head) document.documentElement.prepend(document.createElement("head"));
});

describe("findOnPage", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <h2>Returns</h2>
      <p>Read our refund <b>policy</b> before ordering. Refunds take five days.</p>
      <p>The refund policy also covers gifts.</p>
      <script>refund policy</script>`;
  });

  it("finds a phrase that crosses formatting, and counts every match", () => {
    const out = findOnPage({ query: "refund policy" });
    expect(out).toMatch(/^found 2 matches for "refund policy"/);
    expect(CSS.highlights.get("aalto-find").ranges).toHaveLength(2);
  });

  it("never matches inside scripts", () => {
    document.body.innerHTML = "<script>secret phrase</script><p>nothing</p>";
    expect(findOnPage({ query: "secret phrase" })).toMatch(/isn't on this page/);
  });

  it("quotes the sentence around the match, not the paragraph before", () => {
    const out = findOnPage({ query: "gifts" });
    expect(out).toContain('"The refund policy also covers gifts."');
    expect(out).not.toContain("five days");
  });

  it("steps forward and back through matches, wrapping round", () => {
    findOnPage({ query: "refund" });
    expect(findOnPage({ step: "next" })).toMatch(/^match 2 of 3/);
    expect(findOnPage({ step: "previous" })).toMatch(/^match 1 of 3/);
    expect(findOnPage({ step: "previous" })).toMatch(/^match 3 of 3/);
  });

  it("asks for a query when there is nothing to step through", () => {
    document.body.innerHTML = "<p>x</p>";
    findOnPage({ query: "absent" });
    expect(findOnPage({ step: "next" })).toMatch(/no search to step through/);
    expect(findOnPage({ query: "   " })).toBe("say what to look for.");
  });

  it("does not throw on a document with no <head>", () => {
    document.head.remove();
    expect(() => findOnPage({ query: "refund" })).not.toThrow();
  });
});

describe("goToSection", () => {
  it("jumps to the closest heading", () => {
    document.body.innerHTML = "<h2>Pricing plans</h2><p>..</p><h2>FAQ</h2>";
    expect(goToSection("pricing")).toBe('jumped to the "Pricing plans" section');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("falls back to element ids when there are no good headings", () => {
    document.body.innerHTML = '<h2>Welcome</h2><div id="get-started">..</div>';
    expect(goToSection("get started")).toBe('jumped to the "get started" section');
  });

  it("lists the sections it has when nothing matches", () => {
    document.body.innerHTML = "<h2>Pricing</h2><h2>FAQ</h2>";
    expect(goToSection("careers")).toBe(
      'no section matches "careers". The sections on this page are: Pricing; FAQ.'
    );
  });
});

describe("scrollPage", () => {
  function panel({ scrollTop = 0, scrollHeight = 2000, clientHeight = 500 } = {}) {
    const el = document.createElement("div");
    document.body.append(el);
    Object.defineProperty(el, "scrollHeight", { value: scrollHeight });
    Object.defineProperty(el, "clientHeight", { value: clientHeight });
    el.scrollTop = scrollTop;
    el.scrollTo = vi.fn(({ top }) => {
      el.scrollTop = top;
    });
    return el;
  }

  it("scrolls down by most of a screen and reports progress", () => {
    const el = panel();
    expect(scrollPage("down", "page", el)).toBe(
      "scrolled down - now about 28% of the way down the page"
    );
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 425, behavior: "smooth" });
  });

  it("jumps to the top and bottom", () => {
    const el = panel({ scrollTop: 700 });
    expect(scrollPage("bottom", undefined, el)).toBe("at the bottom of the page");
    expect(scrollPage("top", undefined, el)).toBe("at the top of the page");
  });

  it("says so when it is already at the end", () => {
    expect(scrollPage("up", "page", panel())).toBe("already at the top of the page");
  });

  it("says so when the page does not scroll", () => {
    expect(scrollPage("down", "page", panel({ scrollHeight: 500 }))).toMatch(/doesn't scroll/);
  });
});

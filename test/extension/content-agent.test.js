// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let listener;

beforeAll(async () => {
  vi.stubGlobal("chrome", {
    runtime: { onMessage: { addListener: (fn) => (listener = fn) } },
  });
  Element.prototype.scrollIntoView = vi.fn();
  // happy-dom does no layout: give every element a size, or isVisible() calls
  // the whole page hidden. And it has no execCommand, which leaves the content
  // script on its own fallback path - the one for editors that refuse it.
  Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0 });
  document.execCommand = () => false;
  await import("../../extension/content-agent.js");
});

beforeEach(() => {
  document.body.innerHTML = "";
});

/** Send a message the way the background does, and return the reply. */
function send(message) {
  let reply;
  listener(message, {}, (r) => (reply = r));
  return reply;
}
const tool = (name, args = {}) => send({ type: "TOOL", name, args });

function focus(el) {
  el.focus();
  el.dispatchEvent(new Event("focusin", { bubbles: true }));
}

describe("password and payment fields stay private", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <label for="user">Username</label><input id="user" value="dana">
        <label for="pw">Password</label><input id="pw" type="password" value="hunter2">
        <label for="card">Card number</label><input id="card" autocomplete="cc-number" value="4242424242424242">
        <label for="cvc">Security code</label><input id="cvc" autocomplete="cc-csc" value="123">
        <button type="submit">Sign in</button>
      </form>`;
  });

  it("review_form never reads a secret back", () => {
    const { detail } = tool("review_form");
    expect(detail).toContain("Username: dana");
    expect(detail).not.toMatch(/hunter2|4242|123/);
    expect(detail).toMatch(/Password: \(filled, hidden\)/);
  });

  it("get_context does not include what is typed in a password box", () => {
    focus(document.getElementById("pw"));
    const snap = send({ type: "SNAPSHOT" });
    expect(JSON.stringify(snap)).not.toContain("hunter2");
    expect(snap.field.sensitive).toBe(true);
  });

  it("read_text field refuses on a secret field", () => {
    focus(document.getElementById("card"));
    const res = tool("read_text", { source: "field" });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain("4242");
  });

  it("refuses to type a secret, by fill or by dictation", () => {
    expect(tool("fill_field", { label: "password", value: "s3cret" }).ok).toBe(false);
    focus(document.getElementById("pw"));
    expect(tool("insert_text", { text: "s3cret" }).ok).toBe(false);
    expect(document.getElementById("pw").value).toBe("hunter2");
  });

  it("an error listing the fields does not leak values", () => {
    const res = tool("fill_field", { label: "favourite planet", value: "x" });
    expect(res.ok).toBe(false);
    expect(res.error).not.toMatch(/hunter2|4242/);
  });
});

describe("filling forms", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form id="f">
        <label for="name">Full legal name</label><input id="name">
        <label for="dob">Date of birth</label><input id="dob" type="date">
        <fieldset><legend>Business type</legend>
          <label><input type="radio" name="t" value="sole"> Sole trader</label>
          <label><input type="radio" name="t" value="ltd"> Limited company</label>
        </fieldset>
        <label for="sector">Sector</label>
        <select id="sector"><option>Choose…</option><option>Retail</option><option>Software</option></select>
        <button type="submit">Register</button>
      </form>`;
  });

  it("fills a text field by a loose spoken label", () => {
    expect(tool("fill_field", { label: "name", value: "Dana Whitfield" }).ok).toBe(true);
    expect(document.getElementById("name").value).toBe("Dana Whitfield");
  });

  it("fills a date given in plain English, and refuses an impossible one", () => {
    expect(tool("fill_field", { label: "date of birth", value: "12 April 1990" }).ok).toBe(true);
    expect(document.getElementById("dob").value).toBe("1990-04-12");
    expect(tool("fill_field", { label: "date of birth", value: "31/02/1990" }).ok).toBe(false);
  });

  it("chooses a radio option that was said, and refuses one that was not", () => {
    expect(tool("fill_field", { label: "business type", value: "sole trader" }).ok).toBe(true);
    expect(document.querySelector('[value="sole"]').checked).toBe(true);
    const res = tool("fill_field", { label: "business type", value: "charity" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Ask them which they meant/);
  });

  it("selects from a dropdown, and reads the placeholder back as blank", () => {
    expect(tool("review_form").detail).toMatch(/Sector: blank/);
    expect(tool("fill_field", { label: "sector", value: "retail" }).ok).toBe(true);
    expect(tool("review_form").detail).toMatch(/Sector: Retail/);
  });

  it("refuses a label that fits two fields, and writes neither", () => {
    // The demo form's labels, where a live session put "sole trader" into the
    // business name box: "business type" is half of each.
    document.body.innerHTML = `
      <form>
        <label for="biz">Proposed business name</label><input id="biz">
        <fieldset><legend>Type of registration</legend>
          <label><input type="radio" name="r" value="sole"> Sole trader</label>
        </fieldset>
      </form>`;
    const res = tool("fill_field", { label: "business type", value: "sole trader" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could be "Proposed business name" or "Type of registration"/);
    expect(document.getElementById("biz").value).toBe("");
    expect(document.querySelector('[value="sole"]').checked).toBe(false);
  });

  it("still fills an exact label when a weaker one shares a word", () => {
    expect(tool("fill_field", { label: "business type", value: "sole trader" }).ok).toBe(true);
    expect(document.querySelector('[value="sole"]').checked).toBe(true);
  });

  it("tolerates a non-string value from the model", () => {
    expect(tool("fill_field", { label: "name", value: 42 }).ok).toBe(true);
    expect(document.getElementById("name").value).toBe("42");
  });
});

describe("submit_form", () => {
  it("submits the form that was filled, not another button on the page", () => {
    document.body.innerHTML = `
      <form id="search"><input aria-label="Search"><button type="submit">Send</button></form>
      <form id="signup">
        <label for="email">Email</label><input id="email">
        <button type="submit">Create account</button>
      </form>`;
    const clicked = [];
    for (const b of document.querySelectorAll("button")) {
      b.addEventListener("click", (e) => {
        e.preventDefault();
        clicked.push(b.closest("form").id);
      });
    }
    tool("fill_field", { label: "email", value: "dana@example.com" });
    expect(tool("submit_form").ok).toBe(true);
    expect(clicked).toEqual(["signup"]);
  });

  it("skips disabled buttons", () => {
    document.body.innerHTML = `<form><input aria-label="x"><button type="submit" disabled>Submit</button></form>`;
    expect(tool("submit_form").ok).toBe(false);
  });
});

describe("writing into a box", () => {
  it("appends with a space, and replaces when asked", () => {
    document.body.innerHTML = `<textarea id="t">Hello</textarea>`;
    const t = document.getElementById("t");
    focus(t);
    tool("insert_text", { text: "world", mode: "append" });
    expect(t.value).toBe("Hello world");
    tool("insert_text", { text: "Replaced", mode: "replace" });
    expect(t.value).toBe("Replaced");
  });

  it("asks them to click into a box when none is focused", () => {
    document.body.innerHTML = "<p>no boxes</p>";
    expect(tool("insert_text", { text: "x" }).error).toMatch(/click into the box/);
  });
});

describe("reading", () => {
  it("reads the main content with the title", () => {
    document.title = "Guide";
    document.body.innerHTML = "<nav>menu</nav><main><p>The answer.</p></main>";
    expect(tool("read_text", { source: "page" }).detail).toBe("Guide\n\nThe answer.");
  });

  it("highlights on a document with no <head>", () => {
    document.body.innerHTML = "<p>exact wording here</p>";
    vi.stubGlobal("Highlight", class {});
    vi.stubGlobal("CSS", { escape: (s) => s, highlights: new Map() });
    const head = document.head;
    head.remove();
    try {
      expect(tool("highlight", { quote: "exact wording" }).ok).toBe(true);
    } finally {
      document.documentElement.prepend(head);
      vi.unstubAllGlobals();
      vi.stubGlobal("chrome", { runtime: { onMessage: { addListener() {} } } });
    }
  });

  it("rejects unknown tools by name", () => {
    expect(tool("format_disk").error).toMatch(/format_disk isn't something I can do/);
  });
});

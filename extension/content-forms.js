// Runs on docs.google.com/forms/* pages. Google Forms doesn't expose <label for="">
// binding cleanly, so we match on the question's rendered heading text within each
// question container (role="listitem") instead.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "FORM_ACTION") return false;
  try {
    if (message.action.tool === "fill_form_field") {
      const ok = fillField(message.action.input.fieldLabel, message.action.input.value);
      sendResponse({ ok });
    } else if (message.action.tool === "submit_form") {
      const ok = submitForm();
      sendResponse({ ok });
    }
  } catch (err) {
    console.error("[Aalto] form action error:", err);
    sendResponse({ ok: false, error: String(err) });
  }
  return true;
});

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[*\s]+/g, " ")
    .trim();
}

function getQuestionContainers() {
  return Array.from(document.querySelectorAll('[role="listitem"]'));
}

function findBestMatchingQuestion(spokenLabel) {
  const target = normalize(spokenLabel);
  const containers = getQuestionContainers();

  let best = null;
  let bestScore = 0;
  for (const container of containers) {
    const heading = container.querySelector('[role="heading"]');
    if (!heading) continue;
    const questionText = normalize(heading.textContent);
    const score = similarity(target, questionText);
    if (score > bestScore) {
      bestScore = score;
      best = container;
    }
  }
  // Require some minimum overlap so we don't fill the wrong field on a weak match.
  return bestScore >= 0.3 ? best : null;
}

/** Very small token-overlap similarity - good enough for matching short spoken labels to question text. */
function similarity(a, b) {
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  for (const t of aTokens) if (bTokens.has(t)) overlap++;
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function fillField(fieldLabel, value) {
  const container = findBestMatchingQuestion(fieldLabel);
  if (!container) {
    console.warn(`[Aalto] No form field matched "${fieldLabel}"`);
    return false;
  }

  // Short text / paragraph text
  const textInput = container.querySelector('input[type="text"], textarea');
  if (textInput) {
    setNativeValue(textInput, value);
    return true;
  }

  // Radio buttons / single choice - match option text to the spoken value.
  const radios = Array.from(container.querySelectorAll('[role="radio"]'));
  if (radios.length > 0) {
    const match = radios.find((r) =>
      normalize(r.getAttribute("aria-label")).includes(normalize(value))
    );
    (match ?? radios[0]).click();
    return !!match;
  }

  // Checkboxes - same matching approach, click all that match (spoken value can list multiple).
  const checkboxes = Array.from(container.querySelectorAll('[role="checkbox"]'));
  if (checkboxes.length > 0) {
    const spokenValues = value.split(",").map((v) => normalize(v));
    let anyMatched = false;
    for (const cb of checkboxes) {
      const label = normalize(cb.getAttribute("aria-label"));
      if (spokenValues.some((v) => label.includes(v))) {
        cb.click();
        anyMatched = true;
      }
    }
    return anyMatched;
  }

  console.warn(`[Aalto] Matched question for "${fieldLabel}" but found no fillable input type.`);
  return false;
}

/** React-controlled inputs ignore plain `.value =` assignment; dispatch a real input event too. */
function setNativeValue(element, value) {
  const proto =
    element.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function submitForm() {
  const submitBtn = Array.from(document.querySelectorAll('[role="button"]')).find((b) =>
    normalize(b.textContent).includes("submit")
  );
  if (!submitBtn) {
    console.warn("[Aalto] Submit button not found.");
    return false;
  }
  submitBtn.click();
  return true;
}

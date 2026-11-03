/**
 * One-time microphone permission grant. An offscreen document can USE the
 * microphone but cannot prompt for it, so the prompt has to come from an
 * ordinary extension page. Permission belongs to the extension's origin, so
 * once this succeeds the offscreen recorder works from then on.
 */

const grantBtn = document.getElementById("grant");
const statusEl = document.getElementById("status");

grantBtn.addEventListener("click", async () => {
  grantBtn.disabled = true;
  statusEl.textContent = "Waiting for Chrome's permission prompt…";
  statusEl.className = "";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // We only needed the grant; release the device immediately so no tab sits
    // holding the microphone open.
    for (const track of stream.getTracks()) track.stop();

    statusEl.className = "ok";
    statusEl.textContent = "Microphone enabled. You can close this tab and use Aalto.";
    grantBtn.textContent = "Done";
  } catch (err) {
    grantBtn.disabled = false;
    statusEl.className = "bad";
    statusEl.replaceChildren(...explain(err));
  }
});

/** Built as nodes, not an HTML string: the last case quotes the browser's
 *  error message, and nothing quoted should be able to become markup. */
function explain(err) {
  const name = err?.name ?? "";
  if (name === "NotAllowedError" || /denied|dismiss/i.test(err?.message ?? "")) {
    const steps = document.createElement("ol");
    steps.append(
      el("li", "Click the icon at the left of the address bar (a slider or a lock)."),
      el("li", "Set ", el("strong", "Microphone"), " to ", el("strong", "Allow"), "."),
      el("li", "Reload this page and press the button again.")
    );
    return [
      "Chrome blocked the microphone. To undo that:",
      steps,
      "If there is no microphone entry there, open ",
      el("code", "chrome://settings/content/microphone"),
      " and remove Aalto from the blocked list.",
    ];
  }
  if (name === "NotFoundError") {
    return ["No microphone found. Plug one in, then press the button again."];
  }
  if (name === "NotReadableError") {
    return ["Your microphone is in use by another app. Close it and try again."];
  }
  return [`Could not enable the microphone: ${err?.message ?? err}`];
}

function el(tag, ...children) {
  const node = document.createElement(tag);
  node.append(...children);
  return node;
}

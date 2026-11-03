/**
 * Matching a spoken phrase to a thing on the page - the fuzzy half of form
 * filling, shared by the extension's content script and the demo's sandbox.
 * Touches no DOM, which is why it can be shared at all.
 *
 * Every threshold here came out of watching it get something wrong.
 */

export const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "your",
  "you",
  "my",
  "is",
  "are",
  "was",
  "please",
  "enter",
  "what",
  "whats",
  "which",
  "who",
  "select",
  "choose",
  "provide",
  // Not "type": it is filler in "Type your email", but the whole point of
  // "Business type" or "Type of registration". Dropping it made "business
  // type" mean just "business", a perfect match for "Proposed business name".
  "in",
  "of",
  "for",
  "to",
  "do",
  "does",
  "and",
  "or",
  "this",
  "that",
  "it",
  "here",
]);

export function normalize(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenise(text) {
  return normalize(text)
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w));
}

/**
 * Containment-biased token overlap. Dividing by the LARGER set meant a spoken
 * "name" against "What is your full legal name?" scored 0.17 and missed - short
 * labels failed against verbose questions as a rule. The smaller set asks the
 * right question: is what they said contained in this one?
 */
export function similarity(spoken, questionText) {
  const a = new Set(tokenise(spoken));
  const b = new Set(tokenise(questionText));
  if (a.size === 0 || b.size === 0) return 0;

  let overlap = 0;
  for (const t of a) {
    if (b.has(t)) {
      overlap += 1;
      continue;
    }
    // Partial credit for a shared stem, so "registration" finds "register".
    for (const u of b) {
      if (
        t.length >= 4 &&
        u.length >= 4 &&
        (u.startsWith(t.slice(0, 4)) || t.startsWith(u.slice(0, 4)))
      ) {
        overlap += 0.5;
        break;
      }
    }
  }
  return overlap / Math.min(a.size, b.size);
}

/** How close a spoken label must be to count as naming a field. */
export const FIELD_THRESHOLD = 0.34;

/** How close the runner-up may score before the best is no longer a clear winner. */
const TIE_MARGIN = 0.15;

/**
 * The field a spoken label names: `{ field }`, `{ tied: [label, label] }` when
 * two fields fit about equally, or null when none is close.
 *
 * A tie is refused rather than broken by page order: "name" is a perfect
 * match for both "Full name of applicant" and "Proposed business name", and
 * taking whichever came first puts a value in the wrong box silently - the
 * guess bestOption exists to prevent. Naming both lets the agent ask, or retry
 * with the exact label.
 */
export function pickField(fields, spokenLabel) {
  const scored = fields
    .map((field) => ({ field, score: similarity(spokenLabel, field.label) }))
    .sort((a, b) => b.score - a.score);
  const [best, runnerUp] = scored;
  if (!best || best.score < FIELD_THRESHOLD) return null;
  if (runnerUp && runnerUp.score >= best.score - TIE_MARGIN) {
    return { tied: [best.field.label, runnerUp.field.label] };
  }
  return { field: best.field };
}

/** Higher than the field threshold on purpose: naming the wrong field wastes a
 *  turn, picking the wrong option puts a wrong answer into a form. */
export const OPTION_THRESHOLD = 0.5;

/**
 * Best match, or null if nothing is close enough. Returning null rather than a
 * guess is the entire safety property: an earlier version fell back to the
 * first option, putting a wrong answer into a form nobody had agreed to.
 */
export function bestOption(options, value) {
  const scored = options
    .map((o) => ({ ...o, score: similarity(value, o.text) }))
    .sort((x, y) => y.score - x.score);
  return scored.length > 0 && scored[0].score >= OPTION_THRESHOLD ? scored[0] : null;
}

/**
 * Accept "1990-04-12", "12/04/1990", and plain English like "12 April 1990".
 * Numeric dates are day-first. A date that does not exist - 31 February, month
 * 13 - is refused rather than rolled over into the next month, for the same
 * reason bestOption refuses: a wrong value in a form is worse than a question.
 */
export function toIsoDate(value) {
  const trimmed = String(value ?? "").trim();

  const ymd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return isoIfReal(+ymd[1], +ymd[2], +ymd[3]);

  const dmy = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) return isoIfReal(+dmy[3], +dmy[2], +dmy[1]);

  // Only words from here on: a bare number like "2024" or "5" parses as some
  // arbitrary date, and nobody saying it meant that.
  if (!/[a-z]/i.test(trimmed)) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;

  // Local parts, not toISOString(): local midnight converted to UTC moves back
  // a day for anyone east of Greenwich.
  const d = new Date(parsed);
  return isoIfReal(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * Round-trip through Date rather than a days-in-month table: Date rolls an
 * impossible date over (31 Feb becomes 2 or 3 Mar), so it is real exactly when
 * the parts come back unchanged - leap years included, with nothing to maintain.
 * UTC so no time zone can shift the day.
 */
function isoIfReal(year, month, day) {
  const probe = new Date(Date.UTC(year, month - 1, day));
  const real =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
  if (!real) return null;
  const pad = (n, width = 2) => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

import { type Alignment, align, projectTags, switchNeighbourhood } from "./align";
import type { LangTag, TaggedToken } from "./normalize";

/**
 * Benchmark metrics.
 *
 * Two things the previous implementation got wrong, both of which change the
 * headline numbers:
 *
 *  1. Corpus WER is a RATIO OF SUMS - sum the edits, sum the reference lengths,
 *     divide once. Averaging per-utterance WER ratios (what `average()` did) is a
 *     different and worse estimator that over-weights short utterances.
 *  2. A failed or empty hypothesis scores WER 1.0 (every reference token deleted),
 *     never NaN. Rendering failures as "n/a" quietly rewards the model that fails
 *     on hard audio, because it is then scored on an easier subset.
 *
 * Contains no provider-conditional logic - see the note in normalize.ts.
 */

/** Per-utterance counts. Corpus figures are sums of these, never means of ratios. */
export interface ErrorCounts {
  S: number;
  D: number;
  I: number;
  N: number;
}

export function edits(c: ErrorCounts): number {
  return c.S + c.D + c.I;
}

export function rate(c: ErrorCounts): number {
  return c.N === 0 ? (edits(c) > 0 ? 1 : 0) : edits(c) / c.N;
}

export function addCounts(a: ErrorCounts, b: ErrorCounts): ErrorCounts {
  return { S: a.S + b.S, D: a.D + b.D, I: a.I + b.I, N: a.N + b.N };
}

export const ZERO: ErrorCounts = { S: 0, D: 0, I: 0, N: 0 };

export interface UtteranceMetrics {
  counts: ErrorCounts;
  /** Character-level counts, reported alongside WER for agglutinative Bantu languages. */
  charCounts: ErrorCounts;
  /** Errors on reference tokens inside English spans. */
  english: ErrorCounts;
  /** Errors on reference tokens in the matrix language. */
  matrix: ErrorCounts;
  /** Errors at or adjacent to a language switch point (width 1). */
  switchNear: ErrorCounts;
  switchFar: ErrorCounts;
  /** Maximal English spans deleted wholesale, and the total number of English spans. */
  englishSpansDeleted: number;
  englishSpansTotal: number;
  /** Switch points counted from the tags, for cross-checking the corpus metadata. */
  switchPointCount: number;
  alignment: Alignment<string>;
}

/**
 * Score one utterance.
 *
 * The class-conditional split is exact: S_E + S_M = S, D_E + D_M = D, and with
 * insertions attributed by the neighbour rule I_E + I_M + I_ambig = I. That
 * identity is asserted in the tests, because a decomposition that does not
 * recombine to the overall figure is not a decomposition.
 */
export function scoreUtterance(
  reference: readonly TaggedToken[],
  hypothesis: readonly string[]
): UtteranceMetrics {
  const refTokens = reference.map((t) => t.text);
  const refTags: LangTag[] = reference.map((t) => t.tag);

  const a = align(refTokens, hypothesis);
  const projected = projectTags(a, refTags);
  const near = switchNeighbourhood(refTags, 1);

  const english = { ...ZERO };
  const matrix = { ...ZERO };
  const switchNear = { ...ZERO };
  const switchFar = { ...ZERO };

  for (let i = 0; i < refTags.length; i++) {
    if (refTags[i] === "E") english.N++;
    else matrix.N++;
    if (near.has(i)) switchNear.N++;
    else switchFar.N++;
  }

  a.edits.forEach((e, k) => {
    if (e.op === "MATCH") return;
    const bucket = e.op === "SUB" ? "S" : e.op === "DEL" ? "D" : "I";

    const tag = projected[k];
    if (tag === "E") english[bucket]++;
    else if (tag === "M") matrix[bucket]++;

    if (e.refIndex !== null) {
      if (near.has(e.refIndex)) switchNear[bucket]++;
      else switchFar[bucket]++;
    } else {
      // Attribute an insertion to the neighbourhood of the reference position it
      // sits between, using the same left-preferring rule as tag projection.
      const anchor = nearestRefIndex(a, k);
      if (anchor !== null && near.has(anchor)) switchNear[bucket]++;
      else switchFar[bucket]++;
    }
  });

  const { deleted, total } = englishSpanDeletions(a, refTags);

  return {
    counts: { S: a.S, D: a.D, I: a.I, N: a.N },
    charCounts: characterCounts(refTokens.join(" "), hypothesis.join(" ")),
    english,
    matrix,
    switchNear,
    switchFar,
    englishSpansDeleted: deleted,
    englishSpansTotal: total,
    switchPointCount: countSwitchPoints(refTags),
    alignment: a,
  };
}

function nearestRefIndex(a: Alignment<string>, k: number): number | null {
  for (let p = k - 1; p >= 0; p--) {
    if (a.edits[p].refIndex !== null) return a.edits[p].refIndex;
  }
  for (let p = k + 1; p < a.edits.length; p++) {
    if (a.edits[p].refIndex !== null) return a.edits[p].refIndex;
  }
  return null;
}

function countSwitchPoints(tags: readonly LangTag[]): number {
  let n = 0;
  for (let i = 1; i < tags.length; i++) if (tags[i] !== tags[i - 1]) n++;
  return n;
}

/**
 * Count maximal English spans that were deleted in their entirety.
 *
 * This measures the specific failure the AfriSwitch authors named and did not
 * quantify: the model dropping an embedded English phrase altogether, which
 * aggregate WER can mask.
 */
function englishSpanDeletions(
  a: Alignment<string>,
  refTags: readonly LangTag[]
): { deleted: number; total: number } {
  const opByRefIndex = new Map<number, string>();
  for (const e of a.edits) {
    if (e.refIndex !== null) opByRefIndex.set(e.refIndex, e.op);
  }

  let total = 0;
  let deleted = 0;
  let i = 0;
  while (i < refTags.length) {
    if (refTags[i] !== "E") {
      i++;
      continue;
    }
    let j = i;
    let allDeleted = true;
    while (j < refTags.length && refTags[j] === "E") {
      if (opByRefIndex.get(j) !== "DEL") allDeleted = false;
      j++;
    }
    total++;
    if (allDeleted) deleted++;
    i = j;
  }
  return { deleted, total };
}

/** Character-level counts over the whitespace-joined token strings. */
export function characterCounts(reference: string, hypothesis: string): ErrorCounts {
  const a = align([...reference], [...hypothesis]);
  return { S: a.S, D: a.D, I: a.I, N: a.N };
}

/** Convenience wrapper: plain word error rate between two token lists. */
export function wordErrorRate(reference: readonly string[], hypothesis: readonly string[]): number {
  const a = align(reference, hypothesis);
  return rate({ S: a.S, D: a.D, I: a.I, N: a.N });
}

/** Convenience wrapper: plain character error rate. */
export function characterErrorRate(reference: string, hypothesis: string): number {
  return rate(characterCounts(reference, hypothesis));
}

/**
 * Code-Mixing Index, per Gambäck & Das and as used by the AfriSwitch paper:
 *
 *   CMI = 100 * (1 - max_i(w_i) / (n - u))   when n > u
 *       = 0                                   when n = u
 *
 * where w_i is the token count for language i, n the total token count, and u the
 * count of language-independent tokens. With binary E/M tagging there are no
 * language-independent tokens, so u = 0.
 *
 * Recomputed here purely to validate the corpus's own `cmi` column on a sample -
 * the column itself is what the analysis uses.
 */
export function codeMixingIndex(tags: readonly LangTag[]): number {
  const n = tags.length;
  if (n === 0) return 0;
  const e = tags.filter((t) => t === "E").length;
  const m = n - e;
  const max = Math.max(e, m);
  if (n === 0) return 0;
  return 100 * (1 - max / n);
}

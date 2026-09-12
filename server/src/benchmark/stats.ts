import { addCounts, type ErrorCounts, edits, rate, ZERO } from "./metrics";

/**
 * Bootstrap confidence intervals and paired significance tests.
 *
 * The AfriSwitch paper reports point estimates only - no intervals, no tests - so
 * this is where an independent replication visibly exceeds the published state of
 * the art on this benchmark. It is also cheap: pure arithmetic over ~1,400 numbers.
 *
 * Contains no provider-conditional logic - see the note in normalize.ts.
 */

/** Deterministic PRNG so every reported interval is reproducible from the seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Interval {
  point: number;
  lo: number;
  hi: number;
}

/**
 * Corpus rate: sum the edits, sum the reference lengths, divide once.
 *
 * NOT the mean of per-utterance rates - that is a different estimator which
 * over-weights short utterances. The bootstrap is used rather than a closed-form
 * standard error precisely because this is a ratio.
 */
export function corpusRate(counts: readonly ErrorCounts[]): number {
  return rate(counts.reduce(addCounts, ZERO));
}

/**
 * Stratified percentile bootstrap.
 *
 * The resampling unit is the UTTERANCE, never the word: errors within an utterance
 * are strongly correlated (a mis-set language, a bad acoustic segment, a
 * hallucination loop), so word-level resampling would understate the variance and
 * produce absurdly tight intervals.
 *
 * Resampling happens within each language stratum, preserving the equal-allocation
 * design; an unstratified bootstrap would add between-language composition noise
 * the design deliberately removed.
 */
export function bootstrapCI(
  counts: readonly ErrorCounts[],
  strata: readonly string[],
  opts: { iterations?: number; alpha?: number; seed?: number } = {}
): Interval {
  const { iterations = 10_000, alpha = 0.05, seed = 12345 } = opts;
  const point = corpusRate(counts);
  if (counts.length === 0) return { point, lo: Number.NaN, hi: Number.NaN };

  const groups = groupIndices(strata);
  const rng = mulberry32(seed);
  const samples = new Float64Array(iterations);

  for (let b = 0; b < iterations; b++) {
    let acc = { ...ZERO };
    for (const idx of groups.values()) {
      for (let k = 0; k < idx.length; k++) {
        acc = addCounts(acc, counts[idx[(rng() * idx.length) | 0]]);
      }
    }
    samples[b] = rate(acc);
  }

  const sorted = Float64Array.from(samples).sort();
  return {
    point,
    lo: quantile(sorted, alpha / 2),
    hi: quantile(sorted, 1 - alpha / 2),
  };
}

/**
 * Paired bootstrap on the difference between two systems.
 *
 * The SAME resampled indices are used for both systems. Every model transcribes
 * the same audio, so utterance difficulty dominates the variance and cancels in
 * the difference - independent marginal intervals carry that shared difficulty
 * twice over. Expect paired intervals 2-4x narrower than the marginals, which is
 * why the report must say plainly that overlapping marginal CIs do NOT imply the
 * absence of a significant difference.
 */
export function pairedBootstrapCI(
  a: readonly ErrorCounts[],
  b: readonly ErrorCounts[],
  strata: readonly string[],
  opts: { iterations?: number; alpha?: number; seed?: number } = {}
): Interval {
  const { iterations = 10_000, alpha = 0.05, seed = 12345 } = opts;
  if (a.length !== b.length || a.length !== strata.length) {
    throw new Error("paired bootstrap requires aligned per-utterance arrays");
  }
  const point = corpusRate(a) - corpusRate(b);
  const groups = groupIndices(strata);
  const rng = mulberry32(seed);
  const samples = new Float64Array(iterations);

  for (let it = 0; it < iterations; it++) {
    let accA = { ...ZERO };
    let accB = { ...ZERO };
    for (const idx of groups.values()) {
      for (let k = 0; k < idx.length; k++) {
        const pick = idx[(rng() * idx.length) | 0];
        accA = addCounts(accA, a[pick]);
        accB = addCounts(accB, b[pick]);
      }
    }
    samples[it] = rate(accA) - rate(accB);
  }

  const sorted = Float64Array.from(samples).sort();
  return { point, lo: quantile(sorted, alpha / 2), hi: quantile(sorted, 1 - alpha / 2) };
}

/**
 * Two-sided paired permutation test on per-utterance edit counts.
 *
 * Under the sharp null of exchangeability, each utterance's (edits, N) pair is
 * swapped between systems on a fair coin. The (1 + count) / (R + 1) correction is
 * deliberate: a naive count/R can report p = 0, which is never a valid p-value.
 */
export function pairedPermutationTest(
  a: readonly ErrorCounts[],
  b: readonly ErrorCounts[],
  opts: { iterations?: number; seed?: number } = {}
): number {
  const { iterations = 10_000, seed = 6789 } = opts;
  if (a.length !== b.length) throw new Error("permutation test requires aligned arrays");

  const observed = Math.abs(corpusRate(a) - corpusRate(b));
  const rng = mulberry32(seed);
  let atLeastAsExtreme = 0;

  for (let it = 0; it < iterations; it++) {
    let accA = { ...ZERO };
    let accB = { ...ZERO };
    for (let i = 0; i < a.length; i++) {
      const swap = rng() < 0.5;
      accA = addCounts(accA, swap ? b[i] : a[i]);
      accB = addCounts(accB, swap ? a[i] : b[i]);
    }
    if (Math.abs(rate(accA) - rate(accB)) >= observed) atLeastAsExtreme++;
  }
  return (1 + atLeastAsExtreme) / (iterations + 1);
}

/**
 * Holm-Bonferroni adjustment within a declared family.
 *
 * Four models give 6 pairwise comparisons per metric, across 14 languages and 2
 * normalisation tracks. Uncorrected, that manufactures significance; the absence
 * of a correction is the first thing a statistically literate reviewer looks for.
 */
export function holmBonferroni(pValues: readonly number[]): number[] {
  const n = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p);
  const adjusted = new Array<number>(n);
  let running = 0;
  order.forEach((entry, rank) => {
    const value = Math.min(1, (n - rank) * entry.p);
    running = Math.max(running, value);
    adjusted[entry.i] = running;
  });
  return adjusted;
}

/**
 * Win / loss / tie counts on per-utterance rates.
 *
 * Intuitive to a non-statistician, and it catches the case where one system wins
 * on average only because the other had a handful of catastrophic failures.
 */
export function winLossTie(
  a: readonly ErrorCounts[],
  b: readonly ErrorCounts[]
): { aWins: number; bWins: number; ties: number } {
  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  for (let i = 0; i < a.length; i++) {
    const ra = rate(a[i]);
    const rb = rate(b[i]);
    if (ra < rb) aWins++;
    else if (rb < ra) bWins++;
    else ties++;
  }
  return { aWins, bWins, ties };
}

/**
 * Length-weighted OLS slope of per-utterance rate on a covariate (used for the
 * CMI sensitivity slope: how fast a model degrades as mixing intensifies).
 */
export function weightedSlope(
  counts: readonly ErrorCounts[],
  covariate: readonly number[]
): number {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < counts.length; i++) {
    const w = counts[i].N;
    if (w === 0) continue;
    const x = covariate[i];
    const y = edits(counts[i]) / counts[i].N;
    sw += w;
    sx += w * x;
    sy += w * y;
    sxx += w * x * x;
    sxy += w * x * y;
  }
  const denom = sw * sxx - sx * sx;
  return denom === 0 ? 0 : (sw * sxy - sx * sy) / denom;
}

/** Kendall's tau-b between two rankings, for the ranking-stability table. */
export function kendallTau(a: readonly number[], b: readonly number[]): number {
  let concordant = 0;
  let discordant = 0;
  let tiedA = 0;
  let tiedB = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const da = Math.sign(a[i] - a[j]);
      const db = Math.sign(b[i] - b[j]);
      if (da === 0 && db === 0) continue;
      if (da === 0) tiedA++;
      else if (db === 0) tiedB++;
      else if (da === db) concordant++;
      else discordant++;
    }
  }
  const denom = Math.sqrt((concordant + discordant + tiedA) * (concordant + discordant + tiedB));
  return denom === 0 ? 0 : (concordant - discordant) / denom;
}

function groupIndices(strata: readonly string[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  strata.forEach((s, i) => {
    const list = groups.get(s);
    if (list) list.push(i);
    else groups.set(s, [i]);
  });
  return groups;
}

function quantile(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

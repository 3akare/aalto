/**
 * Levenshtein alignment with backtrace.
 *
 * The previous implementation returned only a distance, which is why none of the
 * code-switching metrics were computable: without the op sequence you cannot say
 * *which* reference tokens were got wrong, so you cannot partition errors by
 * language tag, by proximity to a switch point, or by form-slot membership.
 *
 * Contains no provider-conditional logic - see the note in normalize.ts.
 */

export type EditOp = "MATCH" | "SUB" | "DEL" | "INS";

export interface Edit {
  op: EditOp;
  /** Index into the reference array, or null for an insertion. */
  refIndex: number | null;
  /** Index into the hypothesis array, or null for a deletion. */
  hypIndex: number | null;
}

export interface Alignment<T> {
  edits: Edit[];
  /** Substitutions. */
  S: number;
  /** Deletions - a reference token with no hypothesis counterpart. */
  D: number;
  /** Insertions - a hypothesis token with no reference counterpart. */
  I: number;
  /** Reference length, the WER denominator. */
  N: number;
  reference: readonly T[];
  hypothesis: readonly T[];
}

/**
 * Standard DP alignment, O(N*M) time and memory.
 *
 * Memory is fine at our scale: utterances average ~25 tokens, so the table is a
 * few hundred cells. Backtrace prefers MATCH, then SUB, then DEL, then INS on
 * ties, which keeps the alignment deterministic - a benchmark whose numbers
 * depend on tie-break order is not reproducible.
 */
export function align<T>(
  reference: readonly T[],
  hypothesis: readonly T[],
  eq: (a: T, b: T) => boolean = (a, b) => a === b
): Alignment<T> {
  const n = reference.length;
  const m = hypothesis.length;

  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) cost[i][0] = i;
  for (let j = 0; j <= m; j++) cost[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = eq(reference[i - 1], hypothesis[j - 1]);
      const sub = cost[i - 1][j - 1] + (same ? 0 : 1);
      const del = cost[i - 1][j] + 1;
      const ins = cost[i][j - 1] + 1;
      cost[i][j] = Math.min(sub, del, ins);
    }
  }

  const edits: Edit[] = [];
  let S = 0;
  let D = 0;
  let I = 0;
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const same = eq(reference[i - 1], hypothesis[j - 1]);
      if (cost[i][j] === cost[i - 1][j - 1] + (same ? 0 : 1)) {
        edits.push({
          op: same ? "MATCH" : "SUB",
          refIndex: i - 1,
          hypIndex: j - 1,
        });
        if (!same) S++;
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
      edits.push({ op: "DEL", refIndex: i - 1, hypIndex: null });
      D++;
      i--;
      continue;
    }
    edits.push({ op: "INS", refIndex: null, hypIndex: j - 1 });
    I++;
    j--;
  }

  edits.reverse();
  return { edits, S, D, I, N: n, reference, hypothesis };
}

/**
 * Project reference language tags onto hypothesis positions.
 *
 * A hypothesis token aligned to a reference token (MATCH or SUB) inherits that
 * token's tag. An insertion has no reference counterpart, so it inherits the tag
 * of its nearest aligned neighbour, preferring the left; when the two neighbours
 * disagree the insertion is marked ambiguous rather than being assigned
 * arbitrarily to one class.
 *
 * Returns one entry per edit, parallel to `alignment.edits`.
 */
export function projectTags<T>(
  alignment: Alignment<T>,
  refTags: readonly ("E" | "M")[]
): ("E" | "M" | "AMBIG")[] {
  const { edits } = alignment;
  const out: ("E" | "M" | "AMBIG")[] = new Array(edits.length);

  for (let k = 0; k < edits.length; k++) {
    const e = edits[k];
    if (e.refIndex !== null) {
      out[k] = refTags[e.refIndex];
    } else {
      out[k] = "AMBIG"; // resolved below
    }
  }

  for (let k = 0; k < edits.length; k++) {
    if (edits[k].refIndex !== null) continue;

    let left: "E" | "M" | undefined;
    for (let p = k - 1; p >= 0; p--) {
      const ri = edits[p].refIndex;
      if (ri !== null) {
        left = refTags[ri];
        break;
      }
    }
    let right: "E" | "M" | undefined;
    for (let p = k + 1; p < edits.length; p++) {
      const ri = edits[p].refIndex;
      if (ri !== null) {
        right = refTags[ri];
        break;
      }
    }

    if (left !== undefined && right !== undefined) {
      out[k] = left === right ? left : "AMBIG";
    } else if (left !== undefined) {
      out[k] = left;
    } else if (right !== undefined) {
      out[k] = right;
    } else {
      out[k] = "AMBIG";
    }
  }

  return out;
}

/**
 * Reference positions that are switch points: a token whose language tag differs
 * from its predecessor. Defined exactly as the AfriSwitch paper defines it, so the
 * count can be cross-checked against the corpus's own `num_switch_points` column.
 */
export function switchPoints(refTags: readonly ("E" | "M")[]): number[] {
  const points: number[] = [];
  for (let i = 1; i < refTags.length; i++) {
    if (refTags[i] !== refTags[i - 1]) points.push(i);
  }
  return points;
}

/**
 * Reference positions within `width - 1` tokens of a switch point.
 * width 1 = the switching token itself; width 2 = the boundary pair.
 */
export function switchNeighbourhood(refTags: readonly ("E" | "M")[], width: number): Set<number> {
  const near = new Set<number>();
  for (const p of switchPoints(refTags)) {
    for (let d = -(width - 1); d <= width - 1; d++) {
      const idx = p + d;
      if (idx >= 0 && idx < refTags.length) near.add(idx);
    }
  }
  return near;
}

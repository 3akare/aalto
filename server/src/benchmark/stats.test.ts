import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ErrorCounts } from "./metrics";
import {
  bootstrapCI,
  corpusRate,
  holmBonferroni,
  kendallTau,
  pairedBootstrapCI,
  pairedPermutationTest,
  winLossTie,
} from "./stats";

const c = (S: number, D: number, I: number, N: number): ErrorCounts => ({ S, D, I, N });

describe("corpus rate", () => {
  it("is a ratio of sums, not a mean of ratios", () => {
    // Utterance 1: 1 error in 1 token (rate 1.0). Utterance 2: 1 error in 9 (rate 0.111).
    // Mean of ratios would be 0.556; ratio of sums is 2/10 = 0.2.
    const counts = [c(1, 0, 0, 1), c(1, 0, 0, 9)];
    assert.equal(corpusRate(counts), 0.2);
  });
});

describe("bootstrap", () => {
  const strata = Array.from({ length: 40 }, (_, i) => (i < 20 ? "yo" : "ha"));
  const counts = Array.from({ length: 40 }, (_, i) => c(i % 4, 0, 0, 10));

  it("brackets the point estimate", () => {
    const ci = bootstrapCI(counts, strata, { iterations: 500 });
    assert.ok(ci.lo <= ci.point && ci.point <= ci.hi, `${ci.lo} <= ${ci.point} <= ${ci.hi}`);
  });

  it("is deterministic for a given seed", () => {
    const a = bootstrapCI(counts, strata, { iterations: 500, seed: 7 });
    const b = bootstrapCI(counts, strata, { iterations: 500, seed: 7 });
    assert.deepEqual(a, b);
  });

  it("gives a paired interval narrower than the marginals when systems are correlated", () => {
    // Model B is model A plus a constant small penalty, so difficulty is shared.
    const a = Array.from({ length: 60 }, (_, i) => c(i % 6, 0, 0, 10));
    const b = a.map((x) => c(x.S + 1, 0, 0, 10));
    const st = Array.from({ length: 60 }, () => "yo");

    const ciA = bootstrapCI(a, st, { iterations: 800 });
    const paired = pairedBootstrapCI(a, b, st, { iterations: 800 });
    assert.ok(
      paired.hi - paired.lo < ciA.hi - ciA.lo,
      `paired width ${paired.hi - paired.lo} should be < marginal width ${ciA.hi - ciA.lo}`
    );
    assert.ok(paired.hi < 0, "A should be significantly better than B");
  });
});

describe("permutation test", () => {
  const strata = Array.from({ length: 50 }, () => "yo");

  it("returns a large p when the systems are identical", () => {
    const a = Array.from({ length: 50 }, (_, i) => c(i % 3, 0, 0, 10));
    const p = pairedPermutationTest(a, [...a], { iterations: 500 });
    assert.equal(p, 1);
  });

  it("returns a small p for a large consistent difference", () => {
    const a = Array.from({ length: 50 }, () => c(1, 0, 0, 10));
    const b = Array.from({ length: 50 }, () => c(8, 0, 0, 10));
    const p = pairedPermutationTest(a, b, { iterations: 500 });
    assert.ok(p < 0.01, `expected a small p, got ${p}`);
  });

  it("never returns exactly zero", () => {
    const a = Array.from({ length: 50 }, () => c(0, 0, 0, 10));
    const b = Array.from({ length: 50 }, () => c(10, 0, 0, 10));
    const p = pairedPermutationTest(a, b, { iterations: 200 });
    assert.ok(p > 0, "p-values must be strictly positive");
    assert.equal(p, 1 / 201);
    void strata;
  });
});

describe("holm-bonferroni", () => {
  it("is monotone and never decreases a p-value", () => {
    const raw = [0.001, 0.008, 0.039, 0.041, 0.9];
    const adj = holmBonferroni(raw);
    adj.forEach((a, i) => {
      assert.ok(a >= raw[i], `adjusted ${a} < raw ${raw[i]}`);
    });
    for (let i = 1; i < adj.length; i++) {
      assert.ok(adj[i] >= adj[i - 1], "adjusted p must be monotone in rank order");
    }
  });

  it("caps at 1", () => {
    assert.deepEqual(
      holmBonferroni([0.5, 0.6, 0.7]).every((p) => p <= 1),
      true
    );
  });
});

describe("win/loss/tie and tau", () => {
  it("counts per-utterance wins", () => {
    const a = [c(1, 0, 0, 10), c(5, 0, 0, 10), c(2, 0, 0, 10)];
    const b = [c(2, 0, 0, 10), c(1, 0, 0, 10), c(2, 0, 0, 10)];
    assert.deepEqual(winLossTie(a, b), { aWins: 1, bWins: 1, ties: 1 });
  });

  it("gives tau 1 for identical rankings and -1 for reversed", () => {
    assert.equal(kendallTau([1, 2, 3], [1, 2, 3]), 1);
    assert.equal(kendallTau([1, 2, 3], [3, 2, 1]), -1);
  });
});

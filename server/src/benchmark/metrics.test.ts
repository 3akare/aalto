import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { align, switchPoints } from "./align";
import { addCounts, edits, rate, scoreUtterance, ZERO } from "./metrics";
import {
  isWellFormedTagged,
  normalizeReference,
  normalizeText,
  parseTaggedTranscription,
  stripDiacritics,
} from "./normalize";

const A = (languageCode: string) => ({ track: "A" as const, languageCode });
const B = (languageCode: string) => ({ track: "B" as const, languageCode });
const C = (languageCode: string) => ({ track: "C" as const, languageCode });

describe("alignment", () => {
  it("counts an unambiguous substitution, deletion and insertion", () => {
    // "b"->"x" is the only substitution; "c" can only be a deletion and "e" an
    // insertion, because no other alignment reaches cost 3.
    const a = align(["a", "b", "c", "d", "e"], ["a", "x", "d", "e", "f"]);
    assert.equal(a.N, 5);
    assert.equal(a.S + a.D + a.I, 3);
    assert.equal(a.D, 1);
    assert.equal(a.I, 1);
    assert.equal(a.S, 1);
  });

  it("breaks equal-cost ties deterministically, preferring substitution", () => {
    // Two alignments both cost 3: three substitutions, or sub + del + ins.
    // Which one is chosen must not vary between runs, or the benchmark is not
    // reproducible. The backtrace prefers MATCH, then SUB, then DEL, then INS.
    const a = align(["a", "b", "c", "d"], ["a", "x", "d", "e"]);
    assert.equal(a.S + a.D + a.I, 3);
    assert.equal(a.S, 3);
    assert.equal(a.D, 0);
    assert.equal(a.I, 0);
    // Total edit count - the thing WER actually divides - is tie-break invariant.
    assert.equal(rate({ S: a.S, D: a.D, I: a.I, N: a.N }), 0.75);
  });

  it("scores an empty hypothesis as all deletions, never NaN", () => {
    const a = align(["one", "two", "three"], []);
    assert.equal(a.D, 3);
    assert.equal(rate({ S: a.S, D: a.D, I: a.I, N: a.N }), 1);
  });

  it("scores an empty reference without dividing by zero", () => {
    assert.equal(rate({ S: 0, D: 0, I: 2, N: 0 }), 1);
    assert.equal(rate(ZERO), 0);
  });

  it("finds switch points where the tag changes", () => {
    assert.deepEqual(switchPoints(["M", "M", "E", "E", "M"]), [2, 4]);
    assert.deepEqual(switchPoints(["M", "M", "M"]), []);
  });
});

describe("normalisation - Track A", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    assert.deepEqual(normalizeText("Hello,   World!  ", A("en")), ["hello", "world"]);
  });

  it("strips a trailing question mark so 'name?' matches 'name'", () => {
    assert.deepEqual(normalizeText("name?", A("en")), ["name"]);
  });

  it("removes fillers on both sides", () => {
    assert.deepEqual(normalizeText("um so uh yes hmm", A("en")), ["so", "yes"]);
  });

  it("preserves intra-word apostrophes and hyphens (orthographic in Zulu/Igbo)", () => {
    assert.deepEqual(normalizeText("ng'ithi", A("zu")), ["ng'ithi"]);
    assert.deepEqual(normalizeText("obi-oma", A("ig")), ["obi-oma"]);
  });

  it("folds English spelled-out numerals to digits", () => {
    assert.deepEqual(normalizeText("twenty five", A("en")), ["25"]);
    assert.deepEqual(normalizeText("one hundred and three", A("en")), ["103"]);
    assert.deepEqual(normalizeText("third", A("en")), ["3"]);
  });

  it("strips transcriber annotations", () => {
    assert.deepEqual(normalizeText("yes [inaudible] please", A("en")), ["yes", "please"]);
  });

  it("keeps diacritics", () => {
    assert.deepEqual(normalizeText("orúkọ mi", A("yo")), ["orúkọ", "mi"]);
  });
});

describe("normalisation - Track B (diacritic-insensitive)", () => {
  it("removes Yoruba tone marks and sub-dots", () => {
    assert.deepEqual(normalizeText("orúkọ mi ni", B("yo")), ["oruko", "mi", "ni"]);
  });

  it("removes Igbo dots-below", () => {
    assert.deepEqual(normalizeText("ụlọ ọma", B("ig")), ["ulo", "oma"]);
  });

  it("leaves Hausa hooked letters alone - ɓ ɗ ƙ ƴ are distinct letters, not accents", () => {
    // These are atomic codepoints; NFD does not decompose them, so they must survive.
    assert.deepEqual(normalizeText("ɓarna ɗaya ƙasa ƴan", B("ha")), [
      "ɓarna",
      "ɗaya",
      "ƙasa",
      "ƴan",
    ]);
    assert.equal(stripDiacritics("ɓɗƙƴ"), "ɓɗƙƴ");
  });

  it("is a no-op for Amharic - Ge'ez has no combining marks to strip", () => {
    const text = "ሰላም ነው";
    assert.deepEqual(normalizeText(text, B("am")), normalizeText(text, A("am")));
  });

  it("removes French accents", () => {
    assert.deepEqual(normalizeText("café été", B("fr")), ["cafe", "ete"]);
  });
});

describe("normalisation - Track C (adversarial)", () => {
  it("removes intra-word punctuation that Track B keeps", () => {
    assert.deepEqual(normalizeText("ng'ithi obi-oma", C("zu")), ["ngithi", "obioma"]);
  });

  it("collapses the digit/word axis so '5' and 'five' agree", () => {
    assert.deepEqual(normalizeText("5", C("en")), ["five"]);
    assert.deepEqual(normalizeText("five", C("en")), ["five"]);
  });

  it("collapses elongated repeats", () => {
    assert.deepEqual(normalizeText("sooooo", C("en")), ["so"]);
  });
});

describe("code-switch tag parsing", () => {
  it("labels English spans and matrix tokens", () => {
    const toks = parseTaggedTranscription("mo fẹ [[EN]]register my business[[/EN]] loni");
    assert.deepEqual(
      toks.map((t) => t.tag),
      ["M", "M", "E", "E", "E", "M"]
    );
    assert.deepEqual(
      toks.map((t) => t.text),
      ["mo", "fẹ", "register", "my", "business", "loni"]
    );
  });

  it("detects malformed tag spans", () => {
    assert.ok(isWellFormedTagged("a [[EN]]b[[/EN]] c"));
    assert.ok(!isWellFormedTagged("a [[EN]]b c"));
    assert.ok(!isWellFormedTagged("a [[/EN]]b"));
    assert.ok(!isWellFormedTagged("[[EN]]a [[EN]]b[[/EN]][[/EN]]"));
  });

  it("keeps switch tags through annotation stripping", () => {
    const toks = normalizeReference("mo [inaudible] [[EN]]yes[[/EN]] ni", A("yo"));
    assert.deepEqual(
      toks.map((t) => [t.text, t.tag]),
      [
        ["mo", "M"],
        ["yes", "E"],
        ["ni", "M"],
      ]
    );
  });
});

describe("class-conditional decomposition", () => {
  const reference = parseTaggedTranscription("mo fe [[EN]]register business[[/EN]] loni");

  it("English and matrix counts recombine to the overall counts", () => {
    const m = scoreUtterance(reference, ["mo", "fe", "regista", "loni", "extra"]);
    const recombined = addCounts(m.english, m.matrix);
    // Insertions may be attributed to AMBIG, so they can be lower; S and D must be exact.
    assert.equal(recombined.S, m.counts.S);
    assert.equal(recombined.D, m.counts.D);
    assert.equal(recombined.N, m.counts.N);
    assert.ok(recombined.I <= m.counts.I);
  });

  it("switch-near and switch-far reference counts partition the reference", () => {
    const m = scoreUtterance(reference, ["mo", "fe", "register", "business", "loni"]);
    assert.equal(m.switchNear.N + m.switchFar.N, m.counts.N);
  });

  it("switch point count matches the tag transitions", () => {
    // M M E E M -> transitions at index 2 and index 4
    const m = scoreUtterance(reference, ["mo", "fe", "register", "business", "loni"]);
    assert.equal(m.switchPointCount, 2);
  });

  it("detects an English span deleted wholesale", () => {
    const m = scoreUtterance(reference, ["mo", "fe", "loni"]);
    assert.equal(m.englishSpansTotal, 1);
    assert.equal(m.englishSpansDeleted, 1);
  });

  it("does not flag a span that was merely mis-recognised", () => {
    const m = scoreUtterance(reference, ["mo", "fe", "regista", "bisnes", "loni"]);
    assert.equal(m.englishSpansTotal, 1);
    assert.equal(m.englishSpansDeleted, 0);
  });

  it("a perfect transcription scores zero", () => {
    const m = scoreUtterance(reference, ["mo", "fe", "register", "business", "loni"]);
    assert.equal(edits(m.counts), 0);
    assert.equal(rate(m.counts), 0);
  });

  it("a failed transcription scores 1.0, not NaN", () => {
    const m = scoreUtterance(reference, []);
    assert.equal(rate(m.counts), 1);
    assert.ok(Number.isFinite(rate(m.counts)));
  });
});

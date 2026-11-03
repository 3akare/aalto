import { describe, expect, it } from "vitest";
import {
  bestOption,
  FIELD_THRESHOLD,
  normalize,
  OPTION_THRESHOLD,
  similarity,
  toIsoDate,
  tokenise,
} from "../../shared/matching.js";

describe("normalize / tokenise", () => {
  it("lowercases, strips accents and punctuation", () => {
    expect(normalize("  Café — Crème!  ")).toBe("cafe creme");
  });

  it("drops stopwords", () => {
    expect(tokenise("What is your full legal name?")).toEqual(["full", "legal", "name"]);
  });

  it("treats null and undefined as empty", () => {
    expect(normalize(null)).toBe("");
    expect(tokenise(undefined)).toEqual([]);
  });
});

describe("similarity", () => {
  it("scores a short spoken label against a verbose question as contained", () => {
    expect(similarity("name", "What is your full legal name?")).toBe(1);
  });

  it("gives partial credit for a shared stem", () => {
    expect(similarity("registration", "Register")).toBe(0.5);
  });

  it("is zero when either side has no content words", () => {
    expect(similarity("the", "Name")).toBe(0);
    expect(similarity("name", "")).toBe(0);
  });

  it("does not match unrelated labels above the field threshold", () => {
    expect(similarity("email", "Phone number")).toBeLessThan(FIELD_THRESHOLD);
  });
});

describe("bestOption - the never-guess rule", () => {
  const options = [{ text: "Sole trader" }, { text: "Limited company" }, { text: "Partnership" }];

  it("picks the option that was actually said", () => {
    expect(bestOption(options, "sole trader")?.text).toBe("Sole trader");
  });

  it("returns null rather than the first option when nothing matches", () => {
    expect(bestOption(options, "charity")).toBeNull();
  });

  it("returns null for an empty option list", () => {
    expect(bestOption([], "anything")).toBeNull();
  });

  it("requires a stricter score than field matching", () => {
    expect(OPTION_THRESHOLD).toBeGreaterThan(FIELD_THRESHOLD);
  });
});

describe("toIsoDate", () => {
  it.each([
    ["1990-04-12", "1990-04-12"],
    ["12/04/1990", "1990-04-12"],
    ["1.4.1990", "1990-04-01"],
    ["12 April 1990", "1990-04-12"],
    ["  2024-02-29 ", "2024-02-29"],
  ])("reads %j as %s", (input, expected) => {
    expect(toIsoDate(input)).toBe(expected);
  });

  it.each(["31/02/2024", "2023-02-29", "1990-13-01", "00/04/1990", "2024", "5", "not a date", ""])(
    "refuses the impossible or unreadable %j",
    (input) => {
      expect(toIsoDate(input)).toBeNull();
    }
  );

  it("does not throw on non-strings", () => {
    expect(toIsoDate(undefined)).toBeNull();
  });
});

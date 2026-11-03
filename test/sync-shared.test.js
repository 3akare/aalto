import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("sync-shared --check", () => {
  it("reports the committed copies as in sync with shared/", () => {
    const out = execFileSync("node", ["scripts/sync-shared.mjs", "--check"], { encoding: "utf8" });
    expect(out).toContain("in sync");
  });
});

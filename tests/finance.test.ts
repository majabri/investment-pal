// Smoke test 1 (pure function): src/lib/finance.ts fmtPct.
// Proves the harness runs a pure-function unit test with the @/ alias.
import { describe, it, expect } from "vitest";
import { fmtPct } from "@/lib/finance";

describe("fmtPct", () => {
  it("formats a fraction as a percent with one decimal by default", () => {
    expect(fmtPct(0.1234)).toBe("12.3%");
  });

  it("respects the digits argument", () => {
    expect(fmtPct(0.1234, 2)).toBe("12.34%");
  });

  it("renders an em dash for null/undefined/NaN", () => {
    expect(fmtPct(null)).toBe("—");
    expect(fmtPct(undefined)).toBe("—");
    expect(fmtPct(Number.NaN)).toBe("—");
  });
});

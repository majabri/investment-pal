// What a decision card says about having been replaced (DEC-005, §5.2).
//
// The rule being protected: superseded decisions are not deleted and not
// hidden, they are MARKED. A ledger that exists to be institutional memory has
// to show the view that was held.
import { describe, expect, test } from "bun:test";

import type { DecisionLink } from "@/lib/supersession";
import {
  isHistorical,
  supersessionLabel,
  supersessionStatus,
} from "@/lib/supersessionView";

const d = (
  id: string,
  decided_on: string,
  supersedes_decision_id: string | null = null,
): DecisionLink => ({ id, decided_on, supersedes_decision_id, account_id: "acct-1" });

const V1 = d("v1", "2026-01-10");
const V2 = d("v2", "2026-03-01", "v1");
const V3 = d("v3", "2026-06-15", "v2");
const CHAIN = [V1, V2, V3];

describe("supersessionStatus", () => {
  test("NEGATIVE CONTROL: a lone decision is 'only'", () => {
    // Without this, every assertion below passes on a function that returns
    // `only` for everything.
    const lone = d("solo", "2026-02-02");
    expect(supersessionStatus(lone, [lone])).toEqual({ state: "only" });
  });

  test("the head of a chain is a revision, numbered by the chain", () => {
    expect(supersessionStatus(V3, CHAIN)).toEqual({ state: "revision", revision: 3, of: 3 });
  });

  test("a replaced decision is superseded, and names what replaced it", () => {
    // Naming the replacement is what makes the card navigable. "Superseded" on
    // its own leaves the reader unable to find the current view.
    expect(supersessionStatus(V1, CHAIN)).toEqual({ state: "superseded", replacedBy: "v2" });
    expect(supersessionStatus(V2, CHAIN)).toEqual({ state: "superseded", replacedBy: "v3" });
  });

  test("a superseded decision is still IN the input — marked, not removed", () => {
    // The rule this whole file exists to protect.
    expect(CHAIN).toContain(V1);
    expect(supersessionStatus(V1, CHAIN).state).not.toBe("only");
  });

  test("a two-link chain numbers its head 2 of 2", () => {
    const pair = [V1, V2];
    expect(supersessionStatus(V2, pair)).toEqual({ state: "revision", revision: 2, of: 2 });
  });

  test("an ancestor outside the loaded window shortens the chain, not the truth", () => {
    // The caller did not fetch v1. v2 still replaced something, and saying
    // "revision 1 of 1" would be a claim the data does not support — so the
    // partial chain is reported as what it is.
    const windowed = [V2, V3];
    expect(supersessionStatus(V3, windowed)).toEqual({ state: "revision", revision: 2, of: 2 });
  });
});

describe("supersessionLabel", () => {
  test("NEGATIVE CONTROL: 'only' gets NO label", () => {
    // A badge on every decision is a badge nobody reads.
    expect(supersessionLabel({ state: "only" })).toBeNull();
  });

  test("a superseded card says it is KEPT, not withdrawn", () => {
    // "Superseded" alone reads to some as "withdrawn", and DEC-005's whole
    // point is that the earlier view survives.
    const label = supersessionLabel({ state: "superseded", replacedBy: "v2" })!;
    expect(label).toContain("Superseded");
    expect(label).toContain("Kept");
    expect(label).not.toContain("deleted");
    expect(label).not.toContain("withdrawn");
  });

  test("a revision says the earlier decision is kept too", () => {
    const label = supersessionLabel({ state: "revision", revision: 3, of: 3 })!;
    expect(label).toContain("Revision 3 of 3");
    expect(label).toContain("kept");
  });
});

describe("isHistorical", () => {
  test("only the replaced ones are de-emphasised", () => {
    expect(isHistorical({ state: "superseded", replacedBy: "v2" })).toBe(true);
    // A current head of a chain is the live view and must not be greyed out.
    expect(isHistorical({ state: "revision", revision: 3, of: 3 })).toBe(false);
    expect(isHistorical({ state: "only" })).toBe(false);
  });
});

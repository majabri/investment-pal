// DEC-005 and DEC-002: a recommendation replaced without losing what it replaced.
//
// `decisions` had no link and no account, so the only way to change a
// recommendation was to lose the old one — the ledger that exists to be
// institutional memory forgetting exactly the thing worth remembering: that the
// view changed, when, and to what.
import { describe, expect, test } from "bun:test";

import {
  canSupersede,
  currentDecisions,
  isCurrent,
  supersessionChain,
  supersessionRejection,
} from "@/lib/supersession";
import type { DecisionLink } from "@/lib/supersession";

const d = (
  id: string,
  decided_on: string,
  supersedes_decision_id: string | null = null,
  account_id: string | null = "acct-1",
): DecisionLink => ({ id, decided_on, supersedes_decision_id, account_id });

// A three-link chain: v1 replaced by v2, replaced by v3.
const V1 = d("v1", "2026-01-10");
const V2 = d("v2", "2026-03-01", "v1");
const V3 = d("v3", "2026-06-15", "v2");
const CHAIN = [V1, V2, V3];

describe("isCurrent", () => {
  test("NEGATIVE CONTROL: the head of a chain is current", () => {
    // Without this, every assertion below passes on a function returning false
    // for everything.
    expect(isCurrent(V3, CHAIN)).toBe(true);
  });

  test("a superseded decision is not current — but still exists", () => {
    expect(isCurrent(V1, CHAIN)).toBe(false);
    expect(isCurrent(V2, CHAIN)).toBe(false);
    // The point of DEC-005: it is not current, and it was not deleted.
    expect(CHAIN).toContain(V1);
  });

  test("a lone decision that replaces nothing is current", () => {
    const lone = d("solo", "2026-02-02");
    expect(isCurrent(lone, [lone])).toBe(true);
  });
});

describe("supersessionChain", () => {
  test("it reads oldest first, as the history that led here", () => {
    expect(supersessionChain(V3, CHAIN).map((x) => x.id)).toEqual(["v1", "v2", "v3"]);
  });

  test("a decision replacing nothing is a chain of one", () => {
    expect(supersessionChain(V1, CHAIN).map((x) => x.id)).toEqual(["v1"]);
  });

  test("a missing ancestor stops the walk rather than throwing", () => {
    // An ancestor the caller did not fetch is a gap in the query, not a corrupt
    // ledger, and the partial chain is still true as far as it goes.
    const orphan = d("v9", "2026-07-01", "never-loaded");
    expect(supersessionChain(orphan, [orphan]).map((x) => x.id)).toEqual(["v9"]);
  });

  test("a cycle terminates", () => {
    // The database forbids a self-link and forbids two decisions superseding
    // one, but neither prevents a longer cycle — and a walk that loops forever
    // on bad data is a worse failure than a short answer.
    const a = d("a", "2026-01-01", "b");
    const b = d("b", "2026-01-02", "a");
    const chain = supersessionChain(a, [a, b]);
    expect(chain.length).toBeLessThanOrEqual(2);
    expect(new Set(chain.map((x) => x.id)).size).toBe(chain.length);
  });
});

describe("supersessionRejection", () => {
  test("NEGATIVE CONTROL: a valid replacement is accepted", () => {
    const next = { id: "v4", decided_on: "2026-09-01", account_id: "acct-1" };
    expect(supersessionRejection(next, "v3", CHAIN)).toBeNull();
    expect(canSupersede(next, "v3", CHAIN)).toBe(true);
  });

  test("a decision cannot supersede itself", () => {
    expect(supersessionRejection({ id: "v3", decided_on: "2026-09-01", account_id: "acct-1" }, "v3", CHAIN)).toBe("self");
  });

  test("two decisions cannot both replace one", () => {
    // A fork: a reader cannot tell which is current.
    const rival = { id: "v4", decided_on: "2026-09-01", account_id: "acct-1" };
    expect(supersessionRejection(rival, "v2", CHAIN)).toBe("already_superseded");
  });

  test("an unknown target is refused, not silently linked", () => {
    const next = { id: "v4", decided_on: "2026-09-01", account_id: "acct-1" };
    expect(supersessionRejection(next, "does-not-exist", CHAIN)).toBe("unknown_target");
  });

  test("a decision about another account cannot replace this one", () => {
    const elsewhere = { id: "v4", decided_on: "2026-09-01", account_id: "acct-2" };
    expect(supersessionRejection(elsewhere, "v3", CHAIN)).toBe("different_account");
  });

  test("two NULL accounts do NOT count as agreeing — and are not a MISMATCH either", () => {
    // The check SQL cannot do. Neither row says what it was about, so nothing
    // establishes they are about the same thing — and silently linking them
    // would invent the agreement.
    //
    // But reporting `different_account` would name a conflict nobody observed.
    // The separate reason is the honest one, and the actionable one: record the
    // account, then supersede.
    const unknownAccount = [d("u1", "2026-01-01", null, null)];
    const next = { id: "u2", decided_on: "2026-02-01", account_id: null };
    expect(supersessionRejection(next, "u1", unknownAccount)).toBe("account_not_known");
  });

  test("every pre-migration decision is unsupersedable until its account is recorded", () => {
    // The deliberate consequence. All existing rows carry a NULL account, so
    // none can be superseded until somebody says which account it was about.
    // Refusing is recoverable; a chain built across two accounts is not.
    const legacy = [d("old", "2026-01-01", null, null)];
    expect(canSupersede({ id: "new", decided_on: "2026-09-01", account_id: null }, "old", legacy)).toBe(false);
  });

  test("a known account cannot replace an unknown one either", () => {
    const unknownAccount = [d("u1", "2026-01-01", null, null)];
    const next = { id: "u2", decided_on: "2026-02-01", account_id: "acct-1" };
    // One side says, the other does not: that IS a mismatch, not an absence.
    expect(supersessionRejection(next, "u1", unknownAccount)).toBe("different_account");
  });

  test("a replacement dated before its target inverts the history", () => {
    const backdated = { id: "v4", decided_on: "2026-01-01", account_id: "acct-1" };
    expect(supersessionRejection(backdated, "v3", CHAIN)).toBe("predates_target");
  });

  test("same-day replacement is allowed", () => {
    // A view can change twice in one session, and `decided_on` is a date.
    const sameDay = { id: "v4", decided_on: "2026-06-15", account_id: "acct-1" };
    expect(supersessionRejection(sameDay, "v3", CHAIN)).toBeNull();
  });

  test("a candidate with no id yet is not treated as self", () => {
    // Supersession is decided BEFORE the row exists. An absent id must not
    // collide with the target's.
    expect(supersessionRejection({ decided_on: "2026-09-01", account_id: "acct-1" }, "v3", CHAIN)).toBeNull();
  });
});

describe("currentDecisions", () => {
  test("it returns only what stands", () => {
    expect(currentDecisions(CHAIN).map((x) => x.id)).toEqual(["v3"]);
  });

  test("independent decisions are all current", () => {
    const a = d("a", "2026-01-01");
    const b = d("b", "2026-02-01");
    expect(currentDecisions([a, b]).map((x) => x.id)).toEqual(["a", "b"]);
  });

  test("nothing is deleted — the superseded rows are still in the input", () => {
    // Excluded from the list of what STANDS, not from the ledger. Reading the
    // chain is how you see them, which is the difference between history and
    // clutter.
    expect(CHAIN).toHaveLength(3);
    expect(supersessionChain(currentDecisions(CHAIN)[0], CHAIN)).toHaveLength(3);
  });
});

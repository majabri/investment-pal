// Phase 5, rule 17: the readiness gate.
//
// "Before any portfolio-dependent recommendation, run deterministic checks …
// On failure, block ONLY what materially depends on the failed input, and say
// why. Research and informational features stay available."
//
// The two halves are tested separately because they fail in opposite
// directions: a gate that blocks nothing is the app that shipped, and a gate
// that blocks everything is one people route around.
import { describe, expect, test } from "bun:test";
import { buildV6Prompt, type PromptContext } from "../prompts";
import {
  CAPABILITY_DEPENDENCIES,
  CHECK_IDS,
  CHECK_LABEL,
  blockedReason,
  gate,
  runChecks,
  type Capability,
  type ReadinessCheck,
  type ReadinessInput,
} from "../readiness";

const ready: ReadinessInput = {
  reconciliation: "RECONCILED",
  positions: "IMPORTED_SNAPSHOT",
  quotes: "CURRENT",
  cash: 2_500,
  marginEnabled: false,
  marginUsed: null,
  openOrdersKnown: true,
  policySource: "user_set",
};

const checksFor = (over: Partial<ReadinessInput> = {}) => runChecks({ ...ready, ...over });

/** "No open orders" as an ASSERTION — at the start of a sentence. */
const NO_ORDERS_CLAIM = /(^|[.!?]\s+)no open orders\b/i;

describe("runChecks", () => {
  test("every check rule 17 names is run", () => {
    expect(checksFor().map((c) => c.id)).toEqual([...CHECK_IDS]);
  });

  test("a fully ready account passes everything", () => {
    // NEGATIVE CONTROL for the whole suite: without this, a `runChecks` that
    // returned `fail` for everything would satisfy every assertion below.
    expect(checksFor().every((c) => c.state === "pass")).toBe(true);
  });

  test("every non-pass check says what is wrong", () => {
    // An unexplained block is a dead end. The user has to know which input to
    // go and fix.
    const checks = checksFor({
      reconciliation: null,
      positions: "UNAVAILABLE",
      quotes: "STALE",
      cash: null,
      marginEnabled: null,
      openOrdersKnown: false,
      policySource: "default",
    });
    for (const c of checks) {
      expect(c.state).not.toBe("pass");
      expect(c.detail.length).toBeGreaterThan(0);
    }
  });
});

describe("fail and unknown are not the same state", () => {
  // They send the user to different places — investigate versus import — and
  // collapsing them is the conflation rule 13 forbids everywhere else.
  const state = (id: string, over: Partial<ReadinessInput>) =>
    checksFor(over).find((c) => c.id === id)!.state;

  test("data that is wrong FAILS", () => {
    expect(state("reconciliation", { reconciliation: "NOT_RECONCILED" })).toBe("fail");
    expect(state("positions", { positions: "STALE" })).toBe("fail");
    expect(state("quotes", { quotes: "STALE" })).toBe("fail");
  });

  test("data that is missing is UNKNOWN", () => {
    expect(state("reconciliation", { reconciliation: null })).toBe("unknown");
    expect(state("reconciliation", { reconciliation: "DATA_INCOMPLETE" })).toBe("unknown");
    expect(state("positions", { positions: "UNAVAILABLE" })).toBe("unknown");
    expect(state("cash", { cash: null })).toBe("unknown");
  });
});

describe("the individual checks", () => {
  const state = (id: string, over: Partial<ReadinessInput>) =>
    checksFor(over).find((c) => c.id === id)!.state;

  test("UNSUPPORTED reconciliation is unknown, not a failure", () => {
    // An account with no broker figure can never reconcile. Treating "no such
    // comparison exists" as a fault would block every manually-tracked
    // account forever, and a gate that can never be satisfied is one people
    // route around.
    expect(state("reconciliation", { reconciliation: "UNSUPPORTED" })).toBe("unknown");
  });

  test("a WARNING reconciliation passes", () => {
    // Rule 11 made WARNING the band worth seeing and not worth alarming.
    // Blocking on it would block on rounding drift at scale.
    expect(state("reconciliation", { reconciliation: "WARNING" })).toBe("pass");
  });

  test("cash of zero passes; cash of null does not", () => {
    // The distinction the whole standard rests on.
    expect(state("cash", { cash: 0 })).toBe("pass");
    expect(state("cash", { cash: null })).toBe("unknown");
  });

  test("negative cash is a real state, not an error", () => {
    expect(state("cash", { cash: -120.5 })).toBe("pass");
  });

  test("NaN cash is not a balance", () => {
    expect(state("cash", { cash: NaN })).toBe("unknown");
  });

  test("margin not known is unknown; margin off is fine; margin on with no figure is not", () => {
    expect(state("margin", { marginEnabled: null })).toBe("unknown");
    expect(state("margin", { marginEnabled: false, marginUsed: null })).toBe("pass");
    expect(state("margin", { marginEnabled: true, marginUsed: null })).toBe("unknown");
    expect(state("margin", { marginEnabled: true, marginUsed: 0 })).toBe("pass");
  });

  test("open orders unknown says so, and never says there are none", () => {
    const c = checksFor({ openOrdersKnown: false }).find((x) => x.id === "open_orders")!;
    expect(c.state).toBe("unknown");
    expect(c.detail).toContain("unavailable");
    // Rule 30's example. "No open orders" from missing data can double a
    // position by accident.
    //
    // The forbidden thing is the CLAIM — a sentence asserting there are none —
    // not the phrase. Written first as `/\bno open orders\b/i`, it fired on
    // the detail's own explanation ("it cannot tell an account with no open
    // orders from one whose orders it cannot see"), which is the seventh time
    // in this program a guard has been coarser than the fault it names. A
    // guard that fires on the explanation pressures the next person to delete
    // the explanation.
    expect(c.detail).not.toMatch(NO_ORDERS_CLAIM);
  });

  test("NEGATIVE CONTROL: the claim pattern catches the claim and spares the explanation", () => {
    expect("No open orders.").toMatch(NO_ORDERS_CLAIM);
    expect("Positions imported. No open orders were found.").toMatch(NO_ORDERS_CLAIM);
    expect("It cannot tell an account with no open orders from one it cannot see.").not.toMatch(
      NO_ORDERS_CLAIM,
    );
  });

  test("an unconfirmed policy is unknown", () => {
    // A default nobody chose is not a policy to size a position against.
    expect(state("policy", { policySource: "default" })).toBe("unknown");
    expect(state("policy", { policySource: "legacy_unknown" })).toBe("unknown");
    expect(state("policy", { policySource: "not_set" })).toBe("unknown");
    expect(state("policy", { policySource: "user_set" })).toBe("pass");
  });
});

describe("gate", () => {
  test("research is never blocked, whatever is broken", () => {
    // Rule 17's second sentence, and the reason the unit is a capability
    // rather than a screen.
    const wrecked = checksFor({
      reconciliation: "NOT_RECONCILED",
      positions: "UNAVAILABLE",
      quotes: "UNAVAILABLE",
      cash: null,
      marginEnabled: null,
      openOrdersKnown: false,
      policySource: "not_set",
    });
    expect(gate("research", wrecked).allowed).toBe(true);
    expect(gate("reporting", wrecked).allowed).toBe(true);
  });

  test("position sizing is blocked by a missing cash balance", () => {
    const g = gate("position_sizing", checksFor({ cash: null }));
    expect(g.allowed).toBe(false);
    if (g.allowed) throw new Error("unreachable");
    expect(g.because.map((c) => c.id)).toEqual(["cash"]);
  });

  test("ONLY what depends on the failed input is blocked", () => {
    // The whole point of rule 17. A missing cash balance must not take the
    // goal projection down with it.
    const checks = checksFor({ cash: null });
    expect(gate("position_sizing", checks).allowed).toBe(false);
    expect(gate("margin_advice", checks).allowed).toBe(false);
    expect(gate("goal_projection", checks).allowed).toBe(true);
    expect(gate("rebalancing", checks).allowed).toBe(true);
  });

  test("a stale quote blocks the projection but not margin advice", () => {
    // The converse direction, so the test above cannot be satisfied by a gate
    // that simply blocks the same two capabilities every time.
    const checks = checksFor({ quotes: "STALE" });
    expect(gate("goal_projection", checks).allowed).toBe(false);
    expect(gate("margin_advice", checks).allowed).toBe(true);
  });

  test("a fully ready account blocks nothing", () => {
    const checks = checksFor();
    for (const cap of Object.keys(CAPABILITY_DEPENDENCIES) as Capability[]) {
      expect(gate(cap, checks).allowed).toBe(true);
    }
  });

  test("every blocking check is reported, not just the first", () => {
    const g = gate("position_sizing", checksFor({ cash: null, quotes: "STALE" }));
    if (g.allowed) throw new Error("unreachable");
    expect(g.because.map((c) => c.id).sort()).toEqual(["cash", "quotes"]);
  });
});

describe("blockedReason", () => {
  test("names the checks rather than counting them", () => {
    // "3 checks failed" makes the user hunt; the point is that they can see
    // which input to go and fix.
    const reason = blockedReason(gate("position_sizing", checksFor({ cash: null })))!;
    expect(reason).toContain(CHECK_LABEL.cash);
    expect(reason).toContain("not known");
    expect(reason).not.toMatch(/^\d+ /);
  });

  test("an allowed gate has no reason", () => {
    expect(blockedReason(gate("research", checksFor()))).toBeNull();
  });
});

describe("the dependency table is the rule", () => {
  test("every dependency names a real check", () => {
    // A typo in this table would silently make a capability depend on nothing.
    for (const [cap, deps] of Object.entries(CAPABILITY_DEPENDENCIES)) {
      for (const d of deps) {
        expect(CHECK_IDS as readonly string[]).toContain(d);
      }
      expect(Array.isArray(deps)).toBe(true);
      // Named so the failure message says which capability.
      expect(typeof cap).toBe("string");
    }
  });

  test("position sizing depends on every check", () => {
    // It is the highest-stakes output the app produces: "buy N shares"
    // against a real account. If any check is ever dropped from it, that
    // should be a deliberate edit here too.
    expect([...CAPABILITY_DEPENDENCIES.position_sizing].sort()).toEqual([...CHECK_IDS].sort());
  });

  test("exactly the informational capabilities depend on nothing", () => {
    const free = Object.entries(CAPABILITY_DEPENDENCIES)
      .filter(([, d]) => d.length === 0)
      .map(([c]) => c)
      .sort();
    expect(free).toEqual(["reporting", "research"]);
  });

  test("every check label is present and distinct", () => {
    expect(new Set(Object.values(CHECK_LABEL)).size).toBe(CHECK_IDS.length);
    for (const id of CHECK_IDS) expect(CHECK_LABEL[id]).toBeTruthy();
  });
});

// The gate has to reach the model, not just the screen. A banner the user sees
// while the prompt below it still asks for position sizes against unverified
// data is not a gate — rule 17 is about what gets PRODUCED.
describe("the brief carries the gate's verdict", () => {
  const ctx = (checks: ReadinessCheck[]): PromptContext => ({
    accountName: "Growth Brokerage",
    portfolioValue: 72_500,
    cash: 2_500,
    marginUsed: 0,
    buyingPower: 5_000,
    todaysPL: 0,
    todaysPLPct: 0,
    ipsPositionCapPct: 30,
    ipsPositionCapHard: false,
    ipsMarginCapPct: 25,
    ipsCapsSource: "user_set",
    readiness: checks,
    objective: {
      kind: "set",
      startingValue: 60_000,
      targetValue: 250_000,
      targetDate: "2030-06-30",
      monthlyContribution: 0,
    },
    requiredCagr: 0.2,
    probability: 0.4,
    holdings: [],
    priorities: [],
    userNotes: "",
  });

  test("a ready account says so, once", () => {
    const out = buildV6Prompt({ ...ctx(checksFor()), meeting: "Morning" });
    expect(out).toContain("DATA READINESS: every input this brief depends on was verified.");
  });

  test("an unverified input is named, and the model is told not to substitute", () => {
    const out = buildV6Prompt({ ...ctx(checksFor({ cash: null })), meeting: "Morning" });
    expect(out).toContain("could NOT be verified");
    expect(out).toContain("Cash balance");
    expect(out).toContain("do not infer it from the other figures");
    expect(out).toContain("assumption that a missing figure is zero");
  });

  test("research is not withdrawn along with the numbers", () => {
    // Rule 17's second sentence has to survive into the prompt too, or the
    // model refuses everything and the brief is worthless.
    const out = buildV6Prompt({ ...ctx(checksFor({ cash: null })), meeting: "Morning" });
    expect(out).toContain("remain in scope");
  });

  test("NEGATIVE CONTROL: the ready and unready briefs differ", () => {
    // Without this, a `readinessBlock` that returned a constant would satisfy
    // the assertions above.
    const ok = buildV6Prompt({ ...ctx(checksFor()), meeting: "Morning" });
    const bad = buildV6Prompt({ ...ctx(checksFor({ cash: null })), meeting: "Morning" });
    expect(ok).not.toBe(bad);
    expect(ok).not.toContain("could NOT be verified");
  });
});

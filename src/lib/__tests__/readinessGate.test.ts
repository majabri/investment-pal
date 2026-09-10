// The four-state Readiness Gate (Blueprint §23.2).
//
// The app's gate was a boolean: a capability was allowed or refused. §23.2
// asks for four states, and the missing one is DEGRADED — "some noncritical
// inputs unavailable; bounded conclusions allowed". Without it the choice is a
// full answer or no answer, and a user facing no answer goes and gets one
// somewhere less careful.
import { describe, expect, test } from "bun:test";
import { CAPABILITY_DEPENDENCIES } from "@/lib/readiness";
import type { CheckId, ReadinessCheck } from "@/lib/readiness";
import { CRITICAL_INPUTS, gateCaveat, gateState, mayRun } from "@/lib/readinessGate";

const check = (id: CheckId, state: ReadinessCheck["state"]): ReadinessCheck => ({
  id,
  state,
  label: id.replace("_", " "),
  detail: state === "pass" ? "fine" : "not available",
});

const allPassing = (capability: keyof typeof CAPABILITY_DEPENDENCIES): ReadinessCheck[] =>
  (CAPABILITY_DEPENDENCIES[capability] as readonly CheckId[]).map((id) => check(id, "pass"));

describe("the four states", () => {
  test("everything passing is READY", () => {
    const v = gateState("position_sizing", allPassing("position_sizing"));
    expect(v.state).toBe("READY");
    expect(gateCaveat(v)).toBeNull();
    expect(mayRun(v)).toBe(true);
  });

  test("a CRITICAL input missing is BLOCKED, and may not run", () => {
    const checks = allPassing("position_sizing").map((c) =>
      c.id === "quotes" ? check("quotes", "unknown") : c,
    );
    const v = gateState("position_sizing", checks);
    expect(v.state).toBe("BLOCKED");
    expect(mayRun(v)).toBe(false);
    expect(v.blocking.map((c) => c.id)).toEqual(["quotes"]);
  });

  test("a NONCRITICAL input missing is DEGRADED, and MAY run", () => {
    // The state that did not exist. A committee brief without open-order
    // status is still worth writing, provided it says so.
    const checks = allPassing("committee_recommendation").map((c) =>
      c.id === "open_orders" ? check("open_orders", "unknown") : c,
    );
    const v = gateState("committee_recommendation", checks);
    expect(v.state).toBe("DEGRADED");
    expect(mayRun(v)).toBe(true);
    expect(v.degrading.map((c) => c.id)).toEqual(["open_orders"]);
  });

  test("critical beats noncritical — both missing is BLOCKED", () => {
    const checks = allPassing("committee_recommendation").map((c) =>
      c.id === "open_orders" || c.id === "positions" ? check(c.id, "fail") : c,
    );
    const v = gateState("committee_recommendation", checks);
    expect(v.state).toBe("BLOCKED");
    expect(v.blocking.map((c) => c.id)).toEqual(["positions"]);
    // The degraded input is still reported — it is still missing.
    expect(v.degrading.map((c) => c.id)).toEqual(["open_orders"]);
  });

  test("ERROR is separate from BLOCKED and names no cause", () => {
    // A gate reporting "blocked on quotes" after a crash names a cause nobody
    // established. §23.2: "no implied all-clear."
    const v = gateState("position_sizing", allPassing("position_sizing"), true);
    expect(v.state).toBe("ERROR");
    expect(v.blocking).toEqual([]);
    expect(mayRun(v)).toBe(false);
    const caveat = gateCaveat(v)!;
    expect(caveat).toContain("Nothing here is an all-clear");
    // And it names no input, because none was evaluated.
    expect(caveat).not.toContain("quotes");
  });

  test("`unknown` blocks exactly as `fail` does", () => {
    // Acting on data that is wrong and acting on data that is absent are the
    // same mistake from the user's side.
    const failed = gateState(
      "margin_advice",
      allPassing("margin_advice").map((c) => (c.id === "margin" ? check("margin", "fail") : c)),
    );
    const unknown = gateState(
      "margin_advice",
      allPassing("margin_advice").map((c) => (c.id === "margin" ? check("margin", "unknown") : c)),
    );
    expect(failed.state).toBe("BLOCKED");
    expect(unknown.state).toBe("BLOCKED");
  });

  test("a capability with no dependencies is always READY", () => {
    // Research stays available whatever else is broken — rule 17.
    expect(gateState("research", []).state).toBe("READY");
    expect(gateState("reporting", [check("quotes", "fail")]).state).toBe("READY");
  });
});

describe("the caveat says what is missing", () => {
  test("DEGRADED names the inputs and says conclusions are not drawn", () => {
    const checks = allPassing("committee_recommendation").map((c) =>
      c.id === "open_orders" ? check("open_orders", "unknown") : c,
    );
    const caveat = gateCaveat(gateState("committee_recommendation", checks))!;
    expect(caveat).toContain("open orders");
    expect(caveat).toContain("not drawn here");
  });

  test("BLOCKED says the conclusions are prohibited, not merely absent", () => {
    const checks = allPassing("rebalancing").map((c) =>
      c.id === "positions" ? check("positions", "fail") : c,
    );
    const caveat = gateCaveat(gateState("rebalancing", checks))!;
    expect(caveat).toContain("prohibited");
  });

  test("READY has no caveat — a caveat on a complete answer is noise", () => {
    expect(gateCaveat(gateState("rebalancing", allPassing("rebalancing")))).toBeNull();
  });
});

describe("the criticality table is consistent with the dependency table", () => {
  test("every critical input is actually a dependency of its capability", () => {
    // A typo here would silently DOWNGRADE a critical input to noncritical,
    // turning a BLOCKED into a DEGRADED — the failure mode with real stakes.
    for (const capability of Object.keys(CRITICAL_INPUTS) as (keyof typeof CRITICAL_INPUTS)[]) {
      const deps = CAPABILITY_DEPENDENCIES[capability] as readonly string[];
      for (const id of CRITICAL_INPUTS[capability] as readonly string[]) {
        expect(deps).toContain(id);
      }
    }
  });

  test("position sizing treats every input as critical", () => {
    // The highest-stakes output the app makes. A share count computed around a
    // gap is still a share count.
    expect([...CRITICAL_INPUTS.position_sizing].sort()).toEqual(
      [...CAPABILITY_DEPENDENCIES.position_sizing].sort(),
    );
  });

  test("every capability has an entry, so a new one cannot default to lenient", () => {
    for (const capability of Object.keys(CAPABILITY_DEPENDENCIES)) {
      expect(capability in CRITICAL_INPUTS).toBe(true);
    }
  });
});

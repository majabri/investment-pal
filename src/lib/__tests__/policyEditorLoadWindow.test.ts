// The policy editors must not be usable before the stored policy arrives.
//
// `useIpsLite` returns `query.data ?? IPS_LITE_DEFAULTS`, and TanStack leaves
// `data` undefined until the first fetch resolves. So for the whole initial
// load window the hook hands back the ADR-APP-004 DEFAULTS — 30% / 25% caps
// and, via `MARGIN_POLICY_UNSET`, a NULL margin rate. The editors populated
// from that through an effect, with Save enabled:
//
//   * IPS-lite — showed 30 / 25 and wrote them over the user's stored caps.
//   * Margin rate — showed BLANK even with a rate stored, and blank is this
//     form's "clear the rate" value, so Save UN-SET a correctly-set rate.
//     ADR-APP-007 exists so a missing rate never computes as zero and makes
//     leverage look free; this silently produced a missing rate.
//   * Objective — said "No objective set yet" while it was being fetched.
//
// Phase 4c (#159) made the first one strictly worse: `useIpsLite.save` now
// stamps `caps_source: "user_set"` on any write touching a cap, so a save in
// the load window LAUNDERS THE APP'S OWN DEFAULT INTO A CONFIRMED USER
// PREFERENCE — the masquerade rule 15 exists to prevent.
//
// WHAT THIS TEST IS, honestly: a source guard, not a render test. The three
// cards call `useIpsLite()` / `useGoal()` directly, so exercising their loading
// states means either mocking the Supabase client or restructuring the cards to
// take props. PR #135 chose the restructure; that branch is now unmergeable
// against a `settings.tsx` that has grown three new cards since. This checks
// the invariant that actually matters — a guard exists before the form — and
// says plainly what it cannot see.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const SETTINGS = "src/routes/_authenticated/settings.tsx";

/** The body of one `function Name() { … }` declaration, to its closing brace
 *  at column 0. Crude, and sufficient for this file's flat component style. */
function componentBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in ${SETTINGS}`);
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end === -1 ? undefined : end);
}

const src = readFileSync(SETTINGS, "utf8");

/** `if (isLoading) { … return … }` before anything else renders. */
const GUARD = /if\s*\(\s*isLoading\s*\)\s*\{/;

describe("the policy editors guard the load window", () => {
  for (const name of ["IpsLiteCard", "MarginRateCard", "ObjectiveCard"]) {
    test(`${name} does not render its form until data has arrived`, () => {
      const body = componentBody(src, name);
      expect(body).toMatch(GUARD);
    });

    test(`${name} takes isLoading from its hook`, () => {
      // Without this, a component could satisfy the check above with an
      // `isLoading` that is always false.
      const body = componentBody(src, name);
      expect(body).toMatch(/isLoading[,}]/);
    });

    test(`${name}'s guard comes BEFORE its main return`, () => {
      // A guard after the form has already rendered guards nothing.
      const body = componentBody(src, name);
      const guardAt = body.search(GUARD);
      const returnAt = body.indexOf("\n  return (");
      expect(guardAt).toBeGreaterThan(-1);
      expect(returnAt).toBeGreaterThan(-1);
      expect(guardAt).toBeLessThan(returnAt);
    });
  }

  test("NEGATIVE CONTROL: the pattern matches a real guard and not a comment", () => {
    expect(`  if (isLoading) {\n    return null;\n  }`).toMatch(GUARD);
    expect(`  // if (isLoading) we would return early`).not.toMatch(GUARD);
    expect(`  if (isLoadingSomethingElse) {`).not.toMatch(GUARD);
  });

  test("NEGATIVE CONTROL: componentBody isolates one component", () => {
    // If it returned the whole file, every assertion above would pass because
    // SOME component in it has a guard.
    const body = componentBody(src, "IpsLiteCard");
    expect(body.length).toBeLessThan(src.length / 2);
    expect(body).toContain("IPS-lite");
    expect(body).not.toContain("function MarginRateCard(");
  });

  test("NEGATIVE CONTROL: a card without a guard would fail", () => {
    const unguarded = `function Fake() {\n  const { data } = useIpsLite();\n  return (<div />);\n}`;
    expect(unguarded).not.toMatch(GUARD);
  });
});

describe("what this test cannot see", () => {
  test("it does not exercise a render, and says so", () => {
    // Recorded rather than implied. The cards call their hooks directly, so a
    // render test needs either a Supabase mock or the props restructure #135
    // proposed. Neither is in this change, and a green run here is evidence
    // that a guard EXISTS — not that it behaves correctly under a real
    // loading sequence.
    const notCovered = [
      "the form actually being absent from the DOM during a real fetch",
      "Save being unreachable in that window",
      "the effect not writing state after the guard returns",
    ];
    expect(notCovered.length).toBe(3);
  });
});

// What the app will and will not recommend from right now (Phase 5, rule 17).
//
// The panel exists because "block only what materially depends on the failed
// input, and say why" has a UI half. A gate that silently produces a worse
// answer is the defect; a gate that silently produces no answer is a different
// defect with the same symptom — the user cannot tell a considered refusal
// from a bug.
//
// So this always renders when a capability is blocked, always names the
// checks, and never hides what is still available.
import { Badge } from "@/components/ui/badge";
import {
  CAPABILITY_DEPENDENCIES,
  type Capability,
  type ReadinessCheck,
} from "@/lib/readiness";
import { gateCaveat, gateState } from "@/lib/readinessGate";

const STATE_TONE: Record<ReadinessCheck["state"], string> = {
  pass: "text-emerald-600 dark:text-emerald-400",
  // Amber, not red: an input nobody has supplied is a prompt to import, not a
  // fault to investigate. Red is reserved for data that is actually wrong.
  unknown: "text-amber-600 dark:text-amber-400",
  fail: "text-destructive",
};

const STATE_WORD: Record<ReadinessCheck["state"], string> = {
  pass: "ok",
  unknown: "not known",
  fail: "failed",
};

export function ReadinessPanel({
  checks,
  capability,
  what,
}: {
  checks: ReadinessCheck[];
  capability: Capability;
  /** What is being gated, in the user's words — "this committee brief". */
  what: string;
}) {
  // §23.2's four states, not a boolean.
  //
  // This used to ask `gate()` for allowed/blocked and return NULL when allowed
  // — so DEGRADED had no representation at all. A review running WITHOUT a
  // noncritical input said nothing about it, which is the case the blueprint
  // singles out: "a review may still run in degraded mode, but the output must
  // clearly state what is unavailable and which conclusions are blocked."
  //
  // The boolean also flattened the gap. `readinessGate` splits a capability's
  // inputs into critical and noncritical, because the same input carries
  // different weight in different answers — open orders are critical to a
  // share count and merely degrading to prose a human reads.
  const verdict = gateState(capability, checks);
  const caveat = gateCaveat(verdict);
  // READY is the only silent state. Everything else says something.
  if (caveat === null) return null;

  const needed = CAPABILITY_DEPENDENCIES[capability] as readonly string[];
  const degraded = verdict.state === "DEGRADED";
  const listed = degraded ? verdict.degrading : verdict.blocking;

  return (
    <div
      className={`mb-4 rounded-xl border px-4 py-3 text-xs ${
        degraded
          ? // Amber on a lighter ground: a degraded answer is still an answer,
            // and colouring it like a refusal trains the eye to skip both.
            "border-amber-500/30 bg-amber-500/5"
          : "border-amber-500/40 bg-amber-500/10"
      }`}
      role="status"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {degraded ? `Producing ${what} with gaps.` : `Not ready to produce ${what}.`}
        </span>
        <Badge variant="outline" className="text-[10px] uppercase">
          {verdict.state}
        </Badge>
        {listed.length > 0 ? (
          <Badge variant="outline" className="text-[10px] uppercase">
            {listed.length === 1 ? "1 input" : `${listed.length} inputs`}
          </Badge>
        ) : null}
      </div>
      {/* The sentence the output itself must carry (§23.2). Rendered here so
          the screen and any generated text say the same thing. */}
      <p className="mb-2">{caveat}</p>
      <ul className="space-y-1">
        {listed.map((c) => (
          <li key={c.id}>
            <span className={`font-medium ${STATE_TONE[c.state]}`}>
              {c.label} — {STATE_WORD[c.state]}.
            </span>{" "}
            <span className="text-muted-foreground">{c.detail}</span>
          </li>
        ))}
      </ul>
      {/* The checks this capability depends on that ARE fine. Without them the
          panel reads as "everything is broken", which is both wrong and the
          reason people stop reading these. */}
      <p className="mt-2 text-muted-foreground">
        Passing:{" "}
        {checks
          .filter((c) => needed.includes(c.id) && c.state === "pass")
          .map((c) => c.label)
          .join(", ") || "none of the inputs this needs"}
        . Research, news and the figures on other screens are unaffected.
      </p>
    </div>
  );
}

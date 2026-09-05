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
  gate,
  type Capability,
  type ReadinessCheck,
} from "@/lib/readiness";

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
  const g = gate(capability, checks);
  if (g.allowed) return null;

  const needed = CAPABILITY_DEPENDENCIES[capability] as readonly string[];

  return (
    <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium">Not ready to produce {what}.</span>
        <Badge variant="outline" className="text-[10px] uppercase">
          {g.because.length === 1 ? "1 input" : `${g.because.length} inputs`}
        </Badge>
      </div>
      <ul className="space-y-1">
        {g.because.map((c) => (
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

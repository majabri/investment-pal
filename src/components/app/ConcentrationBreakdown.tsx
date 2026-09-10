// One position, three denominators, each one named on screen (P0-05 / RISK-001).
//
// The holdings table divides by net equity, the sector bars divide by positions
// value, and ADR-APP-004 states the position cap against gross. Those are three
// different numbers for the same holding and the app used to print all of them
// as a bare "%". This panel is where they are shown together, so the difference
// is visible rather than a matter of which screen you happened to open.
//
// It computes nothing itself — every figure comes from `concentration.ts`, so
// the drawer and the table cannot drift apart.
import {
  DENOMINATOR_DEFINITION,
  DENOMINATOR_HEADING,
  DENOMINATOR_KEYS,
  UNKNOWN_PCT,
  denominatorState,
  weights,
} from "@/lib/concentration";
import type { Denominators } from "@/lib/concentration";
import { fmtPct, fmtUSD } from "@/lib/finance";

/**
 * Why a percentage is absent, in the user's words.
 *
 * Three states, three sentences. "Not known" and "nothing to divide by" are
 * different facts about the account and must not share a rendering
 * (ADR-APP-012) — one is fixed by importing balances, the other is simply what
 * an empty or fully-levered account looks like.
 */
function absenceNote(state: "unknown" | "zero"): string {
  return state === "unknown" ? "not known" : "nothing to divide by";
}

export function ConcentrationBreakdown({
  positionValue,
  denoms,
}: {
  positionValue: number;
  denoms: Denominators;
}) {
  const w = weights(positionValue, denoms);
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="mb-2 text-xs font-medium">
        Concentration — {fmtUSD(positionValue)} as a share of
      </div>
      <dl className="space-y-1.5">
        {DENOMINATOR_KEYS.map((key) => {
          const state = denominatorState(denoms, key);
          const pct = w[key];
          return (
            <div key={key} className="flex items-baseline justify-between gap-3 text-xs">
              <dt className="text-muted-foreground">
                {/* The heading carries the denominator; the definition below it
                    carries the arithmetic. Neither is optional — a percentage
                    whose denominator is only in the code is the defect. */}
                {DENOMINATOR_HEADING[key]}
                <span className="block text-[10px] opacity-70">{DENOMINATOR_DEFINITION[key]}</span>
              </dt>
              <dd className="shrink-0 text-right tabular-nums">
                {pct === null ? (
                  <>
                    <span className="font-medium">{UNKNOWN_PCT}</span>
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      {absenceNote(state === "known" ? "zero" : state)}
                    </span>
                  </>
                ) : (
                  <span className="font-medium">{fmtPct(pct)}</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

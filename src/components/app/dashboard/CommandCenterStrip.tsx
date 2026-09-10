// The dashboard's governance strip: freshness · margin meter · constitution
// check (audit brief G4).
//
// It was a ~100-line immediately-invoked function inside `index.tsx`'s JSX.
// The arithmetic came out first (`lib/constitutionCheck.ts`); this is the
// rendering, and it is the surface that tells the holder they have breached
// their own risk policy — so what it says when it CANNOT check matters as much
// as what it says when it can.
//
// Three states that must stay distinct, and the reason this is a component
// rather than a ternary at the call site:
//
//   * no scope resolved   — say which scope, do not evaluate
//   * scope but unknown value — "not checked", never "clean"
//   * checked             — clean, or the breaches
//
// "Constitution: clean" over an unevaluated account asserts that nothing
// breached, having checked nothing. That is the failure this strip exists to
// avoid, and it has a test.
import { Link } from "@tanstack/react-router";
import { fmtPct, fmtUSD } from "@/lib/finance";
import { interestProvenanceShort, type InterestFigure, type RateStatus } from "@/lib/marginCost";
import { UNAVAILABLE } from "@/lib/unavailable";
import type { ConstitutionVerdict } from "@/lib/constitutionCheck";

export function CommandCenterStrip({
  verdict,
  equityPct,
  marginUsed,
  interest,
  rateState,
  staleDays,
  noScope,
  scopeName,
}: {
  verdict: ConstitutionVerdict;
  equityPct: number | null;
  /** The margin debit. NULL = not known, which is not zero. */
  marginUsed: number | null;
  interest: InterestFigure;
  rateState: RateStatus;
  /** Whole days since the newest import. NULL = never imported, not "today". */
  staleDays: number | null;
  noScope: boolean;
  scopeName: string;
}) {
  const { breaches, checkable } = verdict;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border bg-card/60 px-4 py-2 text-xs">
      <span
        className={
          staleDays != null && staleDays >= 1
            ? "font-medium text-amber-500"
            : "text-muted-foreground"
        }
      >
        Positions:{" "}
        {staleDays == null
          ? "never imported"
          : staleDays === 0
            ? "imported today"
            : `imported ${staleDays}d ago`}
      </span>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground">
        Margin{" "}
        {/* Provenance wording comes from marginCost, never from here — a call
            site that writes its own is how "(estimate)" quietly stops
            appearing on one screen. */}
        {marginUsed === null
          ? "not known"
          : marginUsed > 0
            ? `${fmtUSD(marginUsed)} · ${
                interest.kind === "actual"
                  ? `${fmtUSD(interest.accruedMtd, 2)} interest this month`
                  : interest.kind === "estimate"
                    ? `~${fmtUSD(interest.daily, 2)}/day interest`
                    : "no interest figure"
              } (${interestProvenanceShort(interest)}) · equity ${
                equityPct === null ? UNAVAILABLE : fmtPct(equityPct)
              }`
            : "not set"}
      </span>
      <span className="text-muted-foreground">·</span>
      {/* Rate staleness, flagged only when there is a margin balance for it to
          matter to. Amber, not red: an ageing rate is a prompt to re-check,
          not a policy breach — those keep red to themselves. */}
      {marginUsed !== null && marginUsed > 0 && rateState.kind === "stale" ? (
        <>
          <span className="font-medium text-amber-500">Margin rate {rateState.ageDays}d old</span>
          <span className="text-muted-foreground">·</span>
        </>
      ) : null}
      {marginUsed !== null && marginUsed > 0 && rateState.kind === "unset" ? (
        <>
          <Link to="/settings" className="font-medium text-amber-500 hover:underline">
            Set margin rate →
          </Link>
          <span className="text-muted-foreground">·</span>
        </>
      ) : null}
      {/* "Constitution: clean" over an unresolved scope asserts that nothing
          breached, having checked nothing. Say which scope instead. */}
      {noScope ? (
        <span className="text-muted-foreground">Constitution: {scopeName.toLowerCase()}</span>
      ) : !checkable ? (
        /* "clean" here would assert that nothing breached, having been unable
           to evaluate a single limit. */
        <span className="font-medium text-amber-500">
          Constitution: not checked — account value unknown
        </span>
      ) : breaches.length === 0 ? (
        <span className="text-emerald-500">Constitution: clean</span>
      ) : (
        <span className="font-medium text-red-500">⚠ {breaches.join(" · ")}</span>
      )}
      {(staleDays == null || staleDays >= 1) && (
        <Link to="/settings" className="ml-auto font-medium text-primary hover:underline">
          Import now →
        </Link>
      )}
    </div>
  );
}

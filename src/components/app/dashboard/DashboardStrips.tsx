// The dashboard's advisory strips (audit brief G4).
//
// `routes/_authenticated/index.tsx` was 781 lines with eighteen hooks in one
// `Dashboard()` and every strip rendered inline. These are the pieces that are
// pure functions of their data: given the rows, they render, and given none
// they render nothing.
//
// Following the `summary/` pattern — one module of presentational components,
// no data fetching, no arithmetic beyond formatting. The governance arithmetic
// they sit beside lives in `lib/constitutionCheck.ts` for the same reason.
//
// Each strip renders NOTHING when it has no rows, and that is deliberate rather
// than lazy: an advisory strip with an empty list is visual noise that trains
// the eye to skip the region, and the strips that matter are in the same region.
import { fmtUSD } from "@/lib/finance";

/** A committee Action Sheet line recorded for today. */
export type PlanRow = { id: string; recommendation: string; decision: string };

/**
 * Today's Plan — what the committee said this morning, and what came of it.
 *
 * The bullet's colour is the only thing distinguishing a pending line from a
 * settled one, so the state is also given as text to the accessibility tree:
 * colour alone is not information (#135).
 */
export function TodaysPlanStrip({ rows }: { rows: readonly PlanRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label="Today's Plan" className="mb-4 rounded-xl border bg-card/60 px-4 py-3">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Today's Plan — committee Action Sheet
      </h2>
      <ul className="space-y-0.5 text-sm">
        {rows.map((d) => (
          <li key={d.id} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={d.decision === "pending" ? "text-amber-500" : "text-emerald-500"}
            >
              ●
            </span>
            <span className="sr-only">{d.decision === "pending" ? "Pending: " : "Settled: "}</span>
            <span>{d.recommendation}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One rung of a re-entry ladder. */
export type BuybackZone = { pct: number; price: number; status: string };

/** A buy-back plan for one symbol (ADR-APP-003). */
export type BuybackPlanRow = {
  symbol: string;
  decidedOn: string;
  anchor: number;
  zones: readonly BuybackZone[];
};

/**
 * Buy-back zones — where a trimmed position would be re-entered.
 *
 * The advisory wording at the foot is not decoration. The anchor is the LOGGED
 * trim price rather than the broker's fill, so every price below it is an
 * approximation of an approximation, and the app does not place orders.
 */
export function BuybackStrip({ plans }: { plans: readonly BuybackPlanRow[] }) {
  if (plans.length === 0) return null;
  return (
    <section aria-label="Buy-back zones" className="mb-4 rounded-xl border bg-card/60 px-4 py-3">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Buy-back zones — re-entry ladder after trims (advisory)
      </h2>
      <ul className="space-y-1 text-sm">
        {plans.map((p) => (
          <li key={p.symbol} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="font-medium">{p.symbol}</span>
            <span className="text-xs text-muted-foreground">
              trim {p.decidedOn.slice(5)} @ ~{fmtUSD(p.anchor, 2)}
            </span>
            {p.zones.map((z) => (
              <span
                key={z.pct}
                className={
                  z.status === "hit" ? "font-medium text-emerald-500" : "text-muted-foreground"
                }
              >
                {z.pct}% {fmtUSD(z.price, 2)}
                {z.status === "hit" ? " ✓ reached" : ""}
              </span>
            ))}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Anchor ≈ logged trim price (your broker's fill may differ). Advisory only — you execute.
        Expires after 30 days or when the thesis invalidates.
      </p>
    </section>
  );
}

/** An upcoming event worth a chip: an economic release or an earnings date. */
export type AlertChip = { text: string; date: string; kind: string };

/**
 * Upcoming events, as chips.
 *
 * Renders nothing when there are none — not an empty row. The date is shown
 * month-day only because the year is always the current one here and a full
 * date crowds the chip; the underlying value keeps its year.
 */
export function AlertChips({ alerts }: { alerts: readonly AlertChip[] }) {
  if (alerts.length === 0) return null;
  return (
    <section aria-label="Upcoming events" className="mb-4 flex flex-wrap gap-2">
      {alerts.map((a) => (
        <span
          key={a.text + a.date}
          className={`rounded-full border px-3 py-1 text-xs ${
            a.kind === "econ"
              ? "border-warning/40 bg-warning/10"
              : "border-primary/30 bg-primary/10"
          }`}
        >
          <span className="font-medium">{a.date.slice(5)}</span> · {a.text}
        </span>
      ))}
    </section>
  );
}

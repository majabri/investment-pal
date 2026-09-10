// Household and per-category totals (audit brief G4).
//
// The arithmetic is `lib/householdTotals.ts`; this is the rendering. The rule
// it exists to display honestly: one account with an unknown balance makes its
// category — and the household — UNKNOWN, not smaller. `usdOrUnavailable`
// carries that; a bare `fmtUSD` here would print a plausible number.
import { fmtUSD } from "@/lib/finance";
import { usdOrUnavailable } from "@/lib/unavailable";
import { CATEGORY_ORDER } from "@/lib/data/accountGroups";
import type { HouseholdRollup } from "@/lib/householdTotals";

/** A day change, or nothing. Sub-cent moves are noise, not information. */
function DayChange({ value }: { value: number }) {
  if (Math.abs(value) < 0.005) return null;
  return (
    <span className={value >= 0 ? "text-emerald-500" : "text-red-500"}>
      {" "}
      {value >= 0 ? "+" : ""}
      {fmtUSD(value)}
    </span>
  );
}

export function HouseholdStrip({ rollup }: { rollup: HouseholdRollup }) {
  const { total, totalDay, groups } = rollup;
  // No accounts, no strip. An empty household bar is a row of nothing that
  // pushes the real content down.
  if (groups.size === 0) return null;
  return (
    <section
      aria-label="Household totals"
      className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border bg-card/60 px-4 py-2 text-sm"
    >
      <span className="font-medium">
        Household {usdOrUnavailable(total)}
        <DayChange value={totalDay} />
      </span>
      {CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => (
        <span key={c} className="text-muted-foreground">
          {c}{" "}
          <span className="tabular-nums text-foreground">
            {usdOrUnavailable(groups.get(c)!.net)}
          </span>
          <DayChange value={groups.get(c)!.day} />
        </span>
      ))}
    </section>
  );
}

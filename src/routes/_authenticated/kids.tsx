import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { fmtUSD, fmtPct, yearsBetween } from "@/lib/finance";
import { UNAVAILABLE, usdOrUnavailable } from "@/lib/unavailable";
import {
  requiredCagrWithContributions,
  fvWithContributions,
} from "@/lib/objectiveMath";
import { approvedShare, approvedSymbols } from "@/lib/strategy";
import { combinedTarget, nextContributionDate } from "@/lib/accountObjective";
import { kidAccounts } from "@/lib/kidAccounts";
import {
  useAccounts,
  useAllHoldings,
  useHouseholdMembers,
  useStrategies,
  useStrategySymbols,
} from "@/hooks/useAppData";
import { RefreshPricesButton } from "@/components/app/RefreshPricesButton";
import { useQuery } from "@tanstack/react-query";
import { getQuotesFn } from "@/lib/marketServer";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/kids")({ component: KidsPage });


function KidsPage() {
  const { data: accounts = [] } = useAccounts();
  const { data: allHoldings = [] } = useAllHoldings();
  const { data: members = [] } = useHouseholdMembers();
  const { data: strategies = [] } = useStrategies();
  const { data: strategySymbols = [] } = useStrategySymbols();
  // Custodial accounts, by TYPE, with whoever holds them.
  //
  // The seed fallback that used to sit here is gone. When there were no
  // imported accounts this screen rendered `KIDS_SEED` — three named children
  // with hand-copied share counts — and labelled it "seeded 2026-07-21". A
  // second user of this app saw somebody else's children and somebody else's
  // positions, presented exactly like their own. There is no fallback now: no
  // custodial accounts means an empty state (rule 22, no assumed dependants).
  const kidsData = useMemo(
    () => kidAccounts(accounts, allHoldings, members),
    [accounts, allHoldings, members],
  );

  // Live prices: one source of truth, 60s cadence, merged upstream of all math
  const allSymbols = useMemo(
    () => [...new Set(kidsData.flatMap((k) => k.holdings.map((h) => h.symbol)))],
    [kidsData],
  );
  const { data: liveQuotes } = useQuery({
    queryKey: ["kids-quotes", allSymbols.join(",")],
    queryFn: () => getQuotesFn({ data: { symbols: allSymbols } }),
    enabled: allSymbols.length > 0,
    refetchInterval: 60 * 1000,
  });
  const liveKids = useMemo(
    () =>
      kidsData.map((k) => ({
        ...k,
        holdings: k.holdings.map((h) =>
          liveQuotes?.[h.symbol] ? { ...h, price: liveQuotes[h.symbol].price } : h,
        ),
      })),
    [kidsData, liveQuotes],
  );

  // Shared column sort across all three kid tables
  type SortKey = "symbol" | "shares" | "avgCost" | "value" | "gl";
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(k === "symbol" ? 1 : -1);
    }
  };
  const sortVal = (
    h: { symbol: string; shares: number; price: number; avgCost: number },
    k: SortKey,
  ): number | string =>
    k === "symbol"
      ? h.symbol
      : k === "shares"
        ? h.shares
        : k === "avgCost"
          ? h.avgCost
          : k === "value"
            ? h.shares * h.price
            : h.avgCost > 0
              ? (h.price - h.avgCost) / h.avgCost
              : -Infinity;
  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : "");

  // Targets and horizons are per ACCOUNT now (rule 20). They were
  // `FAMILY_POLICY.targetPerChild` / `.targetDate` / `.familyTarget` — one
  // household's objective, compiled in, rendered as every user's progress bar
  // and every user's "Behind / On Track / Ahead" verdict.
  //
  // The family target is all-or-nothing for the same reason the family value
  // is: the sum of the accounts that happen to have a target is not the
  // household's target, and nothing on screen would say so.
  const familyTarget = combinedTarget(kidsData.map((k) => k.objective));
  // Earliest next contribution across the accounts that have a plan. Null when
  // none does — not today's date, and not a $100/14-day schedule nobody set.
  const nextDates = kidsData
    .map((k) => (k.objective.kind === "set" ? k.objective.contribution : null))
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map((c) => nextContributionDate(c).getTime());
  const next =
    nextDates.length === 0
      ? null
      : new Date(Math.min(...nextDates)).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
  // NULL when there is no strategy at all. Not an empty set: an empty set
  // answers "is this approved?" with "no", and there being no list answers it
  // with "nobody has said" (rules 13, 16).
  const strategy = strategies[0] ?? null;
  const approved = approvedSymbols(
    strategy === null ? [] : strategySymbols.filter((s) => s.strategy_id === strategy.id),
  );
  // All-or-nothing: a family total that quietly omits one child's cash is not
  // the family's total (Phase 1a).
  // No accounts is not a total of zero either. `[].reduce(..., 0)` returns 0,
  // which would have printed "$0.00" against a $600,000 target and drawn a 0%
  // bar for a household that has told the app nothing (rule 13).
  const familyTotal = liveKids.length === 0 || liveKids.some((k) => k.cash === null)
    ? null
    : liveKids.reduce(
        (s, k) => s + (k.cash as number) + k.holdings.reduce((x, h) => x + h.shares * h.price, 0),
        0,
      );

  // Rule 22: household is optional, and family surfaces appear only when the
  // applicable account types exist. The screen this replaces could not reach
  // this branch — it fell back to a compiled-in seed of three named children,
  // so it always had something to show whether or not it was yours.
  if (kidsData.length === 0) {
    return (
      <AppShell
        title="Kids Trading Dashboard"
        subtitle="No custodial accounts yet"
      >
        <Card>
          <CardContent className="space-y-3 pt-6 text-sm">
            <p className="font-medium">Nothing to show — and nothing assumed.</p>
            <p className="text-muted-foreground">
              This screen lists accounts whose type is <strong>custodial</strong>. You do not
              have any yet, so there is nothing here. It will not invent a child, a target or a
              balance to fill the space.
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>
                Add the account in <strong>Settings → Accounts</strong> and set its type to
                Custodial. Account type is never guessed from the name.
              </li>
              <li>
                Add whoever it is for under <strong>Settings → Household</strong>, with a birth
                date if you want age-based guidance, and link it to the account.
              </li>
              <li>
                Import positions with <strong>Settings → Portfolio CSV Import</strong>.
              </li>
            </ol>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Kids Trading Dashboard"
      subtitle={
        // The cadence was "every other Thursday" in the copy and 14 days in the
        // code, and both were one household's. Said only when a plan exists.
        // "Family Investment OS v1.0" went with the constants it versioned —
        // a version number on a policy the app no longer holds names nothing.
        next === null ? "No contribution plan set" : `Next contribution ${next}`
      }
    >
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-2 pt-6 text-sm">
          <span>
            <span className="text-muted-foreground">Family value</span>{" "}
            <strong className="tabular-nums">{usdOrUnavailable(familyTotal)}</strong>
          </span>
          <span>
            <span className="text-muted-foreground">Family target</span>{" "}
            <strong className="tabular-nums">{usdOrUnavailable(familyTarget)}</strong>
          </span>
          {/* No bar when the total is unknown. A bar at 0% claims no progress,
              which is a different statement from "we cannot say" — the same
              call made for the goal progress bar in the P0 remediation. And no
              bar when the TARGET is unknown either: progress needs both ends,
              and 100% of an unset target is not 100% of anything. */}
          {familyTotal !== null && familyTarget !== null && familyTarget > 0 && (
            <span className="min-w-40 flex-1">
              <Progress value={(familyTotal / familyTarget) * 100} />
            </span>
          )}
          <span className="tabular-nums text-muted-foreground">
            {familyTotal === null || familyTarget === null || familyTarget <= 0
              ? UNAVAILABLE
              : fmtPct(familyTotal / familyTarget)}
          </span>
          <RefreshPricesButton symbols={allSymbols} />
        </CardContent>
      </Card>
      {familyTarget === null && (
        <p className="-mt-3 mb-6 text-xs text-muted-foreground">
          Family target is unavailable because at least one of these accounts has no target and
          horizon set. Set them per account in Settings — nothing is assumed on your behalf.
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        {liveKids.map((kid) => {
          const mv = kid.holdings.reduce((s, h) => s + h.shares * h.price, 0);
          const total = kid.cash === null ? null : mv + kid.cash;
          // This account's own target and horizon (rule 20). It was
          // FAMILY_POLICY's $200,000 by 2036-07-01 for every account of every
          // user, which is what made the verdict below somebody else's verdict.
          const obj = kid.objective.kind === "set" ? kid.objective : null;
          const target = obj?.targetValue ?? null;
          const years = obj === null ? null : yearsBetween(new Date(), new Date(obj.targetDate));
          // No plan stated is NOT a plan of $0 — but a projection has to use a
          // number, so the honest reading is "project what is here, with no
          // contributions assumed", and the card says the plan is unset.
          const perPeriod = obj?.contribution?.amountUsd ?? 0;
          // Every projection below starts FROM the account value AND from a
          // target the holder set. Without either they are not conservative or
          // approximate, they are arbitrary — and "Behind"/"On Track" is a
          // verdict, which is worse than a wrong number.
          const req =
            total === null || target === null || years === null
              ? null
              : requiredCagrWithContributions(total, target, years, perPeriod);
          const at10 =
            total === null || years === null
              ? null
              : fvWithContributions(total, 0.1, years, perPeriod);
          // NULL when there is no approved universe, and null when the account
          // holds nothing. The version this replaces divided by
          // `Math.max(1, mv)`, so an empty account read "0% in approved names"
          // — a failing grade against a standard nobody had written.
          const inApproved = approvedShare(
            kid.holdings.map((h) => ({ symbol: h.symbol, value: h.shares * h.price })),
            approved,
          );
          const largest = [...kid.holdings].sort(
            (a, b) => b.shares * b.price - a.shares * a.price,
          )[0];
          const empty = kid.holdings.length === 0;
          const status = req === null ? null : req <= 0.08 ? "Ahead" : req <= 0.12 ? "On Track" : "Behind";
          return (
            <Card key={kid.id}>
              <CardHeader className="flex flex-row items-baseline justify-between">
                <div>
                  <CardTitle className="text-base">{kid.name}</CardTitle>
                  {/* The holder and their age come from the linked household
                      member, not from a compiled-in list and not from the
                      account's name. No link means no age — said out loud,
                      because age is what drives the horizon below. */}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {kid.holder === null
                      ? "No household member linked — link one in Settings for age-based guidance"
                      : kid.age === null
                        ? `Held by ${kid.holder} · birth date not set`
                        : `Held by ${kid.holder} · age ${kid.age}`}
                  </p>
                </div>
                <span className="tabular-nums text-sm font-semibold">
                  {usdOrUnavailable(total)}
                </span>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>
                      {target === null
                        ? "No target set for this account"
                        : `Progress toward ${fmtUSD(target)} by ${obj!.targetDate}`}
                    </span>
                    <span className="tabular-nums">
                      {total === null || target === null || target <= 0
                        ? UNAVAILABLE
                        : fmtPct(total / target)}
                    </span>
                  </div>
                  {total !== null && target !== null && target > 0 && (
                    <Progress value={(total / target) * 100} />
                  )}
                  {kid.objective.kind === "unset" && (
                    // Named, not counted. "Set a target" leaves the user
                    // hunting for which half is missing.
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Missing: {kid.objective.missing.join(" and ")} — set them on this account in
                      Settings. Progress, required CAGR and the status verdict all need both.
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Required CAGR</span>
                  <span className="tabular-nums">{req === null ? UNAVAILABLE : fmtPct(req)}</span>
                  <span className="text-muted-foreground">Status</span>
                  <span
                    className={
                      status === "Behind"
                        ? "text-red-500"
                        : status === "Ahead"
                          ? "text-emerald-500"
                          : "text-amber-500"
                    }
                  >
                    {status ?? UNAVAILABLE}
                  </span>
                  <span className="text-muted-foreground">Projected @10%</span>
                  <span className="tabular-nums">{usdOrUnavailable(at10)}</span>
                  <span className="text-muted-foreground">In approved names</span>
                  <span className="tabular-nums">
                    {inApproved === null ? UNAVAILABLE : fmtPct(inApproved)}
                  </span>
                  <span className="text-muted-foreground">Largest position</span>
                  <span>
                    {largest
                      ? `${largest.symbol} (${fmtPct((largest.shares * largest.price) / Math.max(1, mv))})`
                      : "—"}
                  </span>
                  <span className="text-muted-foreground">Cash</span>
                  <span className="tabular-nums">
                    {kid.cash === null ? UNAVAILABLE : fmtUSD(kid.cash, 2)}
                  </span>
                  {(() => {
                    const cost = kid.holdings.reduce((c, h) => c + h.shares * h.avgCost, 0);
                    const gl = mv - cost;
                    return (
                      <>
                        <span className="text-muted-foreground">Gain/Loss</span>
                        <span
                          className={`tabular-nums ${gl >= 0 ? "text-emerald-500" : "text-red-500"}`}
                        >
                          {fmtUSD(gl)} ({cost > 0 ? fmtPct(gl / cost) : "—"})
                        </span>
                      </>
                    );
                  })()}
                </div>
                {empty ? (
                  <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                    No positions in this account yet — run Settings → Portfolio CSV Import and map
                    this child&apos;s account.
                  </p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-left text-[10px] uppercase text-muted-foreground">
                        <th
                          className="cursor-pointer select-none py-1"
                          onClick={() => toggleSort("symbol")}
                        >
                          Symbol{arrow("symbol")}
                        </th>
                        <th
                          className="cursor-pointer select-none text-right"
                          onClick={() => toggleSort("shares")}
                        >
                          Shares{arrow("shares")}
                        </th>
                        <th
                          className="cursor-pointer select-none text-right"
                          onClick={() => toggleSort("avgCost")}
                        >
                          Avg cost{arrow("avgCost")}
                        </th>
                        <th
                          className="cursor-pointer select-none text-right"
                          onClick={() => toggleSort("value")}
                        >
                          Value{arrow("value")}
                        </th>
                        <th
                          className="cursor-pointer select-none text-right"
                          onClick={() => toggleSort("gl")}
                        >
                          G/L{arrow("gl")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...kid.holdings]
                        .sort((a, b) => {
                          const va = sortVal(a, sortKey),
                            vb = sortVal(b, sortKey);
                          return (
                            (typeof va === "string"
                              ? va.localeCompare(vb as string)
                              : (va as number) - (vb as number)) * sortDir
                          );
                        })
                        .map((h) => (
                          <tr key={h.symbol} className="border-b last:border-0">
                            <td className="py-1 font-medium">{h.symbol}</td>
                            <td className="py-1 text-right tabular-nums text-muted-foreground">
                              {h.shares}
                            </td>
                            <td className="py-1 text-right tabular-nums text-muted-foreground">
                              {fmtUSD(h.avgCost, 2)}
                            </td>
                            <td className="py-1 text-right tabular-nums">
                              {fmtUSD(h.shares * h.price)}
                            </td>
                            <td
                              className={`py-1 text-right tabular-nums ${h.price >= h.avgCost ? "text-emerald-500" : "text-red-500"}`}
                            >
                              {h.avgCost > 0 ? fmtPct((h.price - h.avgCost) / h.avgCost) : "—"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {kid.holdings.length} positions · live from your imports
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {/* The parity rule belongs to the strategy and is shown only when one is
          written. It used to be a compiled-in sentence followed by a hardcoded
          editorial note about a specific holding's weight — one household's
          committee agenda, rendered to every user as if it were theirs. */}
      {strategy?.parity_rule ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Parity rule ({strategy.name}): {strategy.parity_rule}
        </p>
      ) : approved === null ? (
        <p className="mt-4 text-xs text-muted-foreground">
          No strategy set, so &ldquo;in approved names&rdquo; is unavailable rather than 0%. Add one
          under Settings → Strategy.
        </p>
      ) : null}
    </AppShell>
  );
}

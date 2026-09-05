import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { fmtUSD, fmtPct, yearsBetween } from "@/lib/finance";
import { UNAVAILABLE, usdOrUnavailable } from "@/lib/unavailable";
import {
  FAMILY_POLICY,
  approvedSymbols,
  nextContributionDate,
  requiredCagrWithContributions,
  fvWithContributions,
} from "@/lib/data/familyPolicy";
import { kidAccounts } from "@/lib/kidAccounts";
import { useAccounts, useAllHoldings, useHouseholdMembers } from "@/hooks/useAppData";
import { RefreshPricesButton } from "@/components/app/RefreshPricesButton";
import { useQuery } from "@tanstack/react-query";
import { getQuotesFn } from "@/lib/marketServer";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/kids")({ component: KidsPage });


function KidsPage() {
  const { data: accounts = [] } = useAccounts();
  const { data: allHoldings = [] } = useAllHoldings();
  const { data: members = [] } = useHouseholdMembers();
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

  const years = yearsBetween(new Date(), new Date(FAMILY_POLICY.targetDate));
  const next = nextContributionDate().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const approved = approvedSymbols();
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
      subtitle={`Family Investment OS v${FAMILY_POLICY.version} · $${FAMILY_POLICY.contribution.amountUsd}/child every other Thursday · next ${next}`}
    >
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-2 pt-6 text-sm">
          <span>
            <span className="text-muted-foreground">Family value</span>{" "}
            <strong className="tabular-nums">{usdOrUnavailable(familyTotal)}</strong>
          </span>
          <span>
            <span className="text-muted-foreground">Family target (2036)</span>{" "}
            <strong className="tabular-nums">{fmtUSD(FAMILY_POLICY.familyTarget)}</strong>
          </span>
          {/* No bar when the total is unknown. A bar at 0% claims no progress,
              which is a different statement from "we cannot say" — the same
              call made for the goal progress bar in the P0 remediation. */}
          {familyTotal !== null && (
            <span className="min-w-40 flex-1">
              <Progress value={(familyTotal / FAMILY_POLICY.familyTarget) * 100} />
            </span>
          )}
          <span className="tabular-nums text-muted-foreground">
            {familyTotal === null
              ? UNAVAILABLE
              : fmtPct(familyTotal / FAMILY_POLICY.familyTarget)}
          </span>
          <RefreshPricesButton symbols={allSymbols} />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        {liveKids.map((kid) => {
          const mv = kid.holdings.reduce((s, h) => s + h.shares * h.price, 0);
          const total = kid.cash === null ? null : mv + kid.cash;
          // Every projection below starts FROM the account value. Without it
          // they are not conservative or approximate, they are arbitrary — and
          // "Behind"/"On Track" is a verdict, which is worse than a wrong number.
          const req =
            total === null
              ? null
              : requiredCagrWithContributions(
                  total,
                  FAMILY_POLICY.targetPerChild,
                  years,
                  FAMILY_POLICY.contribution.amountUsd,
                );
          const at10 =
            total === null
              ? null
              : fvWithContributions(total, 0.1, years, FAMILY_POLICY.contribution.amountUsd);
          const approvedShare =
            kid.holdings
              .filter((h) => approved.has(h.symbol))
              .reduce((s, h) => s + h.shares * h.price, 0) / Math.max(1, mv);
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
                    <span>Progress toward {fmtUSD(FAMILY_POLICY.targetPerChild)}</span>
                    <span className="tabular-nums">
                      {total === null
                        ? UNAVAILABLE
                        : fmtPct(total / FAMILY_POLICY.targetPerChild)}
                    </span>
                  </div>
                  {total !== null && (
                    <Progress value={(total / FAMILY_POLICY.targetPerChild) * 100} />
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
                  <span className="tabular-nums">{fmtPct(approvedShare)}</span>
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
      <p className="mt-4 text-xs text-muted-foreground">
        Parity rule: {FAMILY_POLICY.parityRule} TSLA (~15% each) sits outside the approved list —
        standing committee agenda item.
      </p>
    </AppShell>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { fmtUSD, fmtPct, yearsBetween } from "@/lib/finance";
import { FAMILY_POLICY, approvedSymbols, nextContributionDate, requiredCagrWithContributions, fvWithContributions } from "@/lib/data/familyPolicy";
import { KIDS_SEED, type KidAccount } from "@/lib/data/kidsSeed";
import { useAccounts, useHoldings } from "@/hooks/useAppData";
import { RefreshPricesButton } from "@/components/app/RefreshPricesButton";
import { useQuery } from "@tanstack/react-query";
import { getQuotesFn } from "@/lib/marketServer";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/kids")({ component: KidsPage });

const KID_NAMES = ["Karim", "Zain", "Jude"];

function KidsPage() {
  const { data: accounts = [] } = useAccounts();
  const { data: allHoldings = [] } = useHoldings();
  const dbKidAccounts = accounts.filter((a) => KID_NAMES.includes(a.name));

  // Database-first: imported kid accounts win; seed is the pre-import fallback.
  const kidsData: KidAccount[] = dbKidAccounts.length
    ? dbKidAccounts.map((a) => ({
        key: a.name.toLowerCase(),
        name: a.name,
        accountNumber: "",
        cash: Number(a.cash ?? 0),
        holdings: allHoldings
          .filter((h) => h.account_id === a.id)
          .map((h) => ({
            symbol: h.symbol,
            shares: Number(h.quantity),
            price: Number(h.current_price),
            avgCost: Number(h.cost_basis),
          })),
      }))
    : KIDS_SEED;
  const liveSource = dbKidAccounts.length > 0;

  // Live prices: one source of truth, 60s cadence, merged upstream of all math
  const allSymbols = useMemo(() => [...new Set(kidsData.flatMap((k) => k.holdings.map((h) => h.symbol)))], [kidsData]);
  const { data: liveQuotes } = useQuery({
    queryKey: ["kids-quotes", allSymbols.join(",")],
    queryFn: () => getQuotesFn({ data: { symbols: allSymbols } }),
    enabled: allSymbols.length > 0,
    refetchInterval: 60 * 1000,
  });
  const liveKids = useMemo(() => kidsData.map((k) => ({
    ...k,
    holdings: k.holdings.map((h) => liveQuotes?.[h.symbol] ? { ...h, price: liveQuotes[h.symbol].price } : h),
  })), [kidsData, liveQuotes]);

  // Shared column sort across all three kid tables
  type SortKey = "symbol" | "shares" | "avgCost" | "value" | "gl";
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(k === "symbol" ? 1 : -1); }
  };
  const sortVal = (h: { symbol: string; shares: number; price: number; avgCost: number }, k: SortKey): number | string =>
    k === "symbol" ? h.symbol
    : k === "shares" ? h.shares
    : k === "avgCost" ? h.avgCost
    : k === "value" ? h.shares * h.price
    : h.avgCost > 0 ? (h.price - h.avgCost) / h.avgCost : -Infinity;
  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : "");

  const years = yearsBetween(new Date(), new Date(FAMILY_POLICY.targetDate));
  const next = nextContributionDate().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const approved = approvedSymbols();
  const familyTotal = liveKids.reduce((s, k) => s + k.cash + k.holdings.reduce((x, h) => x + h.shares * h.price, 0), 0);

  return (
    <AppShell title="Kids Dashboard" subtitle={`Family Investment OS v${FAMILY_POLICY.version} · $${FAMILY_POLICY.contribution.amountUsd}/child every other Thursday · next ${next}`}>
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-2 pt-6 text-sm">
          <span><span className="text-muted-foreground">Family value</span> <strong className="tabular-nums">{fmtUSD(familyTotal)}</strong></span>
          <span><span className="text-muted-foreground">Family target (2036)</span> <strong className="tabular-nums">{fmtUSD(FAMILY_POLICY.familyTarget)}</strong></span>
          <span className="min-w-40 flex-1"><Progress value={(familyTotal / FAMILY_POLICY.familyTarget) * 100} /></span>
          <span className="tabular-nums text-muted-foreground">{fmtPct(familyTotal / FAMILY_POLICY.familyTarget)}</span>
          <RefreshPricesButton symbols={allSymbols} />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        {liveKids.map((kid) => {
          const mv = kid.holdings.reduce((s, h) => s + h.shares * h.price, 0);
          const total = mv + kid.cash;
          const req = requiredCagrWithContributions(total, FAMILY_POLICY.targetPerChild, years, FAMILY_POLICY.contribution.amountUsd);
          const at10 = fvWithContributions(total, 0.10, years, FAMILY_POLICY.contribution.amountUsd);
          const approvedShare = kid.holdings.filter((h) => approved.has(h.symbol)).reduce((s, h) => s + h.shares * h.price, 0) / Math.max(1, mv);
          const largest = [...kid.holdings].sort((a, b) => b.shares * b.price - a.shares * a.price)[0];
          const empty = kid.holdings.length === 0;
          const status = req <= 0.08 ? "Ahead" : req <= 0.12 ? "On Track" : "Behind";
          const age = FAMILY_POLICY.children.find((c) => c.key === kid.key)?.age;
          return (
            <Card key={kid.key}>
              <CardHeader className="flex flex-row items-baseline justify-between">
                <CardTitle className="text-base">{kid.name} ({age})</CardTitle>
                <span className="tabular-nums text-sm font-semibold">{fmtUSD(total)}</span>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>Progress toward {fmtUSD(FAMILY_POLICY.targetPerChild)}</span>
                    <span className="tabular-nums">{fmtPct(total / FAMILY_POLICY.targetPerChild)}</span>
                  </div>
                  <Progress value={(total / FAMILY_POLICY.targetPerChild) * 100} />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Required CAGR</span><span className="tabular-nums">{fmtPct(req)}</span>
                  <span className="text-muted-foreground">Status</span>
                  <span className={status === "Behind" ? "text-red-500" : status === "Ahead" ? "text-emerald-500" : "text-amber-500"}>{status}</span>
                  <span className="text-muted-foreground">Projected @10%</span><span className="tabular-nums">{fmtUSD(at10)}</span>
                  <span className="text-muted-foreground">In approved names</span><span className="tabular-nums">{fmtPct(approvedShare)}</span>
                  <span className="text-muted-foreground">Largest position</span>
                  <span>{largest ? `${largest.symbol} (${fmtPct((largest.shares * largest.price) / Math.max(1, mv))})` : "—"}</span>
                  <span className="text-muted-foreground">Cash</span><span className="tabular-nums">{fmtUSD(kid.cash, 2)}</span>
                  {(() => {
                    const cost = kid.holdings.reduce((c, h) => c + h.shares * h.avgCost, 0);
                    const gl = mv - cost;
                    return (
                      <>
                        <span className="text-muted-foreground">Gain/Loss</span>
                        <span className={`tabular-nums ${gl >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                          {fmtUSD(gl)} ({cost > 0 ? fmtPct(gl / cost) : "—"})
                        </span>
                      </>
                    );
                  })()}
                </div>
                {empty ? (
                  <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                    No positions in this account yet — run Settings → Portfolio CSV Import and map this child&apos;s account.
                  </p>
                ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-[10px] uppercase text-muted-foreground">
                      <th className="cursor-pointer select-none py-1" onClick={() => toggleSort("symbol")}>Symbol{arrow("symbol")}</th>
                      <th className="cursor-pointer select-none text-right" onClick={() => toggleSort("shares")}>Shares{arrow("shares")}</th>
                      <th className="cursor-pointer select-none text-right" onClick={() => toggleSort("avgCost")}>Avg cost{arrow("avgCost")}</th>
                      <th className="cursor-pointer select-none text-right" onClick={() => toggleSort("value")}>Value{arrow("value")}</th>
                      <th className="cursor-pointer select-none text-right" onClick={() => toggleSort("gl")}>G/L{arrow("gl")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...kid.holdings].sort((a, b) => {
                      const va = sortVal(a, sortKey), vb = sortVal(b, sortKey);
                      return (typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * sortDir;
                    }).map((h) => (
                      <tr key={h.symbol} className="border-b last:border-0">
                        <td className="py-1 font-medium">{h.symbol}</td>
                        <td className="py-1 text-right tabular-nums text-muted-foreground">{h.shares}</td>
                        <td className="py-1 text-right tabular-nums text-muted-foreground">{fmtUSD(h.avgCost, 2)}</td>
                        <td className="py-1 text-right tabular-nums">{fmtUSD(h.shares * h.price)}</td>
                        <td className={`py-1 text-right tabular-nums ${h.price >= h.avgCost ? "text-emerald-500" : "text-red-500"}`}>
                          {h.avgCost > 0 ? fmtPct((h.price - h.avgCost) / h.avgCost) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}
                <p className="text-[11px] text-muted-foreground">{kid.holdings.length} positions{liveSource ? " · live from your Fidelity imports" : " · seeded 2026-07-21 — run a Fidelity Import to go live"}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Parity rule: {FAMILY_POLICY.parityRule} TSLA (~15% each) sits outside the approved list — standing committee agenda item.
      </p>
    </AppShell>
  );
}

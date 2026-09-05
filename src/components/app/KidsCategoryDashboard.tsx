// Shared dashboard for a category of per-kid accounts (529, Crypto).
// Same layout & behavior as the Kids Trading Dashboard: live prices (60s),
// per-kid cards, sortable holdings, day G/L, group total.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAccounts, useAllHoldings } from "@/hooks/useAppData";
import { getQuotesFn } from "@/lib/marketServer";
import { fmtUSD, fmtPct } from "@/lib/finance";
import { usdOrUnavailable } from "@/lib/unavailable";
import { accountCategory, type AccountCategory } from "@/lib/data/accountGroups";
import { accountTotals } from "@/lib/accountTotals";
import { cn } from "@/lib/utils";

type SortKey = "symbol" | "shares" | "avgCost" | "value" | "gl";

export function KidsCategoryDashboard({
  title,
  subtitle,
  category,
  emptyHint,
}: {
  title: string;
  subtitle: string;
  /**
   * Which accounts this dashboard covers, by TYPE.
   *
   * This was a `(name: string) => string | null` matcher built from a regex
   * over the owner's children's first names — it both selected the accounts and
   * produced the label. Selection now comes from `account_type` and the label
   * from the account's own name (Phase 1b, rule 4).
   */
  category: AccountCategory;
  emptyHint: string;
}) {
  const { data: accounts = [] } = useAccounts();
  const { data: allHoldings = [] } = useAllHoldings();

  const kidAccounts = accounts
    .filter((a) => accountCategory(a) === category)
    // Alphabetical by the account's own name. The previous order came from a
    // hardcoded list of three children, so a fourth account sorted to the front
    // (indexOf returns -1) and a second household had no order at all.
    .map((a) => ({ a, kid: a.name.trim() }))
    .sort((x, y) => x.kid.localeCompare(y.kid));

  const symbols = useMemo(
    () => [
      ...new Set(
        allHoldings
          .filter((h) => kidAccounts.some((k) => k.a.id === h.account_id))
          .map((h) => h.symbol),
      ),
    ],
    [allHoldings, kidAccounts],
  );
  const { data: quotes } = useQuery({
    queryKey: ["kids-cat-quotes", title, symbols.join(",")],
    queryFn: () => getQuotesFn({ data: { symbols } }),
    enabled: symbols.length > 0,
    refetchInterval: 60 * 1000,
  });
  const px = (h: { symbol: string; current_price: number }) =>
    quotes?.[h.symbol]?.price ?? h.current_price;

  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(k === "symbol" ? 1 : -1);
    }
  };
  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : "");

  const rows = kidAccounts.map(({ a, kid }) => {
    const hs = allHoldings.filter((h) => h.account_id === a.id);
    // One engine (Phase 3a, rule 9), rather than this screen's own copy of
    // `positions + cash`.
    const t = accountTotals(hs, a, px);
    const mv = t.positionsValue;
    const cash = t.cash;
    const value = t.totalAccountValue;
    const cost = t.costBasis;
    const day = hs.reduce((s, h) => {
      const q = quotes?.[h.symbol];
      return q && q.prevClose > 0 ? s + h.quantity * (q.price - q.prevClose) : s;
    }, 0);
    return { a, kid, hs, value, cost, mv, day };
  });
  // All-or-nothing, like every other blend after Phase 1a: a group total that
  // silently omits one child's account is not the group's total.
  const total = rows.some((r) => r.value === null)
    ? null
    : rows.reduce((s, r) => s + (r.value as number), 0);
  const totalDay = rows.reduce((s, r) => s + r.day, 0);

  const sortVal = (
    h: { symbol: string; quantity: number; cost_basis: number; current_price: number },
    k: SortKey,
  ): number | string => {
    const p = px(h);
    return k === "symbol"
      ? h.symbol
      : k === "shares"
        ? h.quantity
        : k === "avgCost"
          ? h.cost_basis
          : k === "value"
            ? h.quantity * p
            : h.cost_basis > 0
              ? (p - h.cost_basis) / h.cost_basis
              : -Infinity;
  };

  return (
    <AppShell title={title} subtitle={subtitle}>
      <div className="mb-4 rounded-xl border bg-card/60 px-4 py-2 text-sm">
        <span className="font-semibold">{usdOrUnavailable(total)}</span>
        <span
          className={cn("ml-2 tabular-nums", totalDay >= 0 ? "text-emerald-500" : "text-red-500")}
        >
          {totalDay >= 0 ? "+" : ""}
          {fmtUSD(totalDay)} today
        </span>
        <span className="ml-3 text-muted-foreground">
          {rows.map((r) => `${r.kid} ${usdOrUnavailable(r.value)}`).join(" · ")}
        </span>
      </div>
      {rows.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">{emptyHint}</CardContent>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {rows.map(({ a, kid, hs, value, cost, mv, day }) => {
          const gl = cost > 0 ? (mv - cost) / cost : null;
          return (
            <Card key={a.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{kid}</span>
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      day >= 0 ? "text-emerald-500" : "text-red-500",
                    )}
                  >
                    {day >= 0 ? "+" : ""}
                    {fmtUSD(day)} today
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-1 text-lg font-semibold tabular-nums">
                  {usdOrUnavailable(value)}
                </div>
                <div className="mb-2 text-xs text-muted-foreground">
                  {gl != null && (
                    <span className={cn(gl >= 0 ? "text-emerald-500" : "text-red-500")}>
                      {gl >= 0 ? "+" : ""}
                      {fmtPct(gl)} total
                    </span>
                  )}
                  {a.cash === null || a.cash === undefined ? (
                    <span className="ml-2">cash not known</span>
                  ) : Number(a.cash) > 0 ? (
                    <span className="ml-2">cash {fmtUSD(Number(a.cash), 2)}</span>
                  ) : null}
                </div>
                {hs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No positions.</p>
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
                      {[...hs]
                        .sort((x, y) => {
                          const vx = sortVal(x, sortKey),
                            vy = sortVal(y, sortKey);
                          return (
                            (typeof vx === "string"
                              ? vx.localeCompare(vy as string)
                              : (vx as number) - (vy as number)) * sortDir
                          );
                        })
                        .map((h) => {
                          const p = px(h);
                          const g = h.cost_basis > 0 ? (p - h.cost_basis) / h.cost_basis : null;
                          return (
                            <tr key={h.id} className="border-b last:border-0">
                              <td className="py-1 font-medium">{h.symbol}</td>
                              <td className="text-right tabular-nums">
                                {Number(h.quantity).toLocaleString("en-US", {
                                  maximumFractionDigits: 4,
                                })}
                              </td>
                              <td className="text-right tabular-nums">
                                {h.cost_basis > 0 ? fmtUSD(h.cost_basis, 2) : "--"}
                              </td>
                              <td className="text-right tabular-nums">{fmtUSD(h.quantity * p)}</td>
                              <td
                                className={cn(
                                  "text-right tabular-nums",
                                  g == null
                                    ? "text-muted-foreground"
                                    : g >= 0
                                      ? "text-emerald-500"
                                      : "text-red-500",
                                )}
                              >
                                {g == null ? "--" : `${g >= 0 ? "+" : ""}${fmtPct(g)}`}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}

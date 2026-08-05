import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Save, Trash2, Wallet, RefreshCw } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

import { AppShell } from "@/components/app/AppShell";
import { StatCard } from "@/components/app/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useHoldings, useAccount, useLogSync, type Holding } from "@/hooks/useAppData";
import { useAccounts } from "@/hooks/useAppData";
import { RefreshPricesButton } from "@/components/app/RefreshPricesButton";
import { ThesisDialog } from "@/components/app/ThesisDialog";
import { MarginCard } from "@/components/app/MarginCard";
import { sectorFor } from "@/lib/data/sectors";
import { useQuery } from "@tanstack/react-query";
import { getQuotesFn } from "@/lib/marketServer";
import { fmtUSD, fmtPct } from "@/lib/finance";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/portfolio")({
  head: () => ({
    meta: [
      { title: "Portfolio — Investment Companion" },
      { name: "description", content: "Holdings, allocation, and per-position thesis." },
    ],
  }),
  component: PortfolioPage,
});

function PortfolioPage() {
  const qc = useQueryClient();
  const { data: allHoldings = [] } = useHoldings();
  const { data: accountsList = [] } = useAccounts();
  // This page is Amir's portfolio only — kids live on the Kids Dashboard.
  const amirAccount = accountsList.find((a) => a.name === "Amir - TOD");
  // Amir's rows = his account + any accountless manual adds (kids always have accounts)
  const holdings = amirAccount
    ? allHoldings.filter((h) => h.account_id === amirAccount.id || h.account_id == null)
    : allHoldings.filter((h) => h.account_id == null);
  const { data: account, upsert } = useAccount();
  const logSync = useLogSync();
  const [selected, setSelected] = useState<Holding | null>(null);

  const { data: liveQuotes, dataUpdatedAt } = useQuery({
    queryKey: ["pf-quotes", holdings.map((h) => h.symbol).join(",")],
    queryFn: () => getQuotesFn({ data: { symbols: holdings.map((h) => h.symbol) } }),
    enabled: holdings.length > 0,
    refetchInterval: 60 * 1000, // live: every 60s
  });
  type PfSortKey = "symbol" | "last" | "dayGL" | "totalGL" | "value" | "pct" | "qty" | "avgCost" | "totalCost";
  const [pfSortKey, setPfSortKey] = useState<PfSortKey>("value");
  const [pfSortDir, setPfSortDir] = useState<1 | -1>(-1);
  const togglePfSort = (k: PfSortKey) => {
    if (k === pfSortKey) setPfSortDir((d) => (d === 1 ? -1 : 1));
    else { setPfSortKey(k); setPfSortDir(k === "symbol" ? 1 : -1); }
  };
  const pfArrow = (k: PfSortKey) => (pfSortKey === k ? (pfSortDir === 1 ? " ▲" : " ▼") : "");

  // One source of truth for prices: live quote when available, else last saved.
  const liveHoldings = useMemo(() => holdings.map((h) =>
    liveQuotes?.[h.symbol] ? { ...h, current_price: liveQuotes[h.symbol].price } : h,
  ), [holdings, liveQuotes]);
  const positionsValue = liveHoldings.reduce((s, h) => s + h.quantity * h.current_price, 0);
  const costBasis = liveHoldings.reduce((s, h) => s + h.quantity * h.cost_basis, 0);
  const pl = positionsValue - costBasis;
  const plPct = costBasis > 0 ? pl / costBasis : 0;

  const sectorData = useMemo(() => {
    const map = new Map<string, number>();
    holdings.forEach((h) => {
      const val = h.quantity * h.current_price;
      const k = h.sector || "Unclassified";
      map.set(k, (map.get(k) ?? 0) + val);
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [holdings]);

  const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

  return (
    <AppShell
      title="Portfolio"
      subtitle="Holdings, cash, margin, and thesis."
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              logSync.mutate(
                { detail: "Manual refresh from portfolio" },
                { onSuccess: () => toast.success("Sync logged") },
              )
            }
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Gross — investments"
          value={fmtUSD(positionsValue + Number(amirAccount?.cash ?? 0))}
          hint={`${holdings.length} positions${Number(amirAccount?.cash ?? 0) > 0 ? ` + cash ${fmtUSD(Number(amirAccount?.cash ?? 0))}` : ""}`}
          icon={<Wallet className="h-4 w-4" />}
        />
        <MarginCard
          accountId={amirAccount?.id ?? null}
          accountName="Amir - TOD"
          marginUsed={Number(amirAccount?.margin_used ?? 0)}
        />
        <StatCard
          label="Net — actual account value"
          value={fmtUSD(positionsValue + Number(amirAccount?.cash ?? 0) - Number(amirAccount?.margin_used ?? 0))}
          hint="Gross − margin loan · matches Fidelity's Total account value"
        />
        <StatCard label="Total Gain/Loss" value={`${fmtUSD(pl)} (${fmtPct(plPct)})`} tone={pl >= 0 ? "positive" : "negative"} />
        <StatCard label="Buying power" value={fmtUSD(Number(amirAccount?.buying_power ?? account?.buying_power ?? 0))} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border bg-card p-5 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">Holdings</span>
            <span className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Amir - TOD only{dataUpdatedAt ? ` · as of ${new Date(dataUpdatedAt).toLocaleTimeString("en-US")}` : ""}
              </span>
              <RefreshPricesButton symbols={holdings.map((h) => h.symbol)} />
            </span>
          </div>
          {holdings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No holdings yet. Click "Add position" or import from Fidelity in Settings.
            </p>
          ) : (
            <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer select-none" onClick={() => togglePfSort("symbol")}>Symbol{pfArrow("symbol")}</TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => togglePfSort("last")}>Last Price{pfArrow("last")}</TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => togglePfSort("dayGL")}>Today's G/L{pfArrow("dayGL")}</TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => togglePfSort("totalGL")}>Total G/L{pfArrow("totalGL")}</TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => togglePfSort("value")}>Current Value{pfArrow("value")}</TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => togglePfSort("pct")}>% of Acct{pfArrow("pct")}</TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => togglePfSort("qty")}>Qty{pfArrow("qty")}</TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => togglePfSort("avgCost")}>Avg Cost{pfArrow("avgCost")}</TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => togglePfSort("totalCost")}>Total Cost{pfArrow("totalCost")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...liveHoldings]
                  .sort((a, b) => {
                    const metric = (h: typeof a): number | string => {
                      const q = liveQuotes?.[h.symbol];
                      const price = q?.price ?? h.current_price;
                      const value = h.quantity * price;
                      const cost = h.quantity * h.cost_basis;
                      switch (pfSortKey) {
                        case "symbol": return h.symbol;
                        case "last": return price;
                        case "dayGL": return q && q.prevClose > 0 ? h.quantity * (price - q.prevClose) : -Infinity;
                        case "totalGL": return cost > 0 ? value - cost : -Infinity;
                        case "value": return value;
                        case "pct": return value; // same ordering as value
                        case "qty": return h.quantity;
                        case "avgCost": return h.cost_basis;
                        case "totalCost": return cost;
                      }
                    };
                    const va = metric(a), vb = metric(b);
                    return (typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * pfSortDir;
                  })
                  .map((h) => {
                  const q = liveQuotes?.[h.symbol];
                  const price = q?.price ?? h.current_price;
                  const value = h.quantity * price;
                  const cost = h.quantity * h.cost_basis;
                  const totalGL = value - cost;
                  const dayGL = q && q.prevClose > 0 ? h.quantity * (price - q.prevClose) : null;
                  const dayPct = q && q.prevClose > 0 ? (price - q.prevClose) / q.prevClose : null;
                  // Fidelity divides % of Acct by TOTAL ACCOUNT VALUE (net equity) —
                  // verified against real statements (CRWD 32.24%, LRCX 26.84%, ...).
                  const netAcct = positionsValue + Number(amirAccount?.cash ?? 0) - Number(amirAccount?.margin_used ?? 0);
                  const pctOfAcct = netAcct > 0 ? value / netAcct : 0;
                  const unpriced = !q;
                  return (
                    <TableRow key={h.id} className="cursor-pointer" onClick={() => setSelected(h)}>
                      <TableCell className="font-medium">
                        {h.symbol}
                        {unpriced && <span className="ml-1 align-super text-[9px] text-muted-foreground">t</span>}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {unpriced ? (h.current_price > 0 ? fmtUSD(h.current_price, 2) : "--") : (
                          <>
                            {fmtUSD(price, 2)}
                            {dayPct != null && (
                              <div className={`text-[11px] ${dayPct >= 0 ? "text-success" : "text-destructive"}`}>
                                {dayPct >= 0 ? "+" : ""}{fmtPct(dayPct)}
                              </div>
                            )}
                          </>
                        )}
                      </TableCell>
                      <TableCell className={`text-right tabular ${dayGL == null ? "text-muted-foreground" : dayGL >= 0 ? "text-success" : "text-destructive"}`}>
                        {dayGL == null ? "--" : `${dayGL >= 0 ? "+" : ""}${fmtUSD(dayGL)}`}
                      </TableCell>
                      <TableCell className={`text-right tabular ${cost <= 0 ? "text-muted-foreground" : totalGL >= 0 ? "text-success" : "text-destructive"}`}>
                        {cost > 0 ? `${totalGL >= 0 ? "+" : ""}${fmtUSD(totalGL)} (${fmtPct(totalGL / cost)})` : "--"}
                      </TableCell>
                      <TableCell className="text-right tabular">{value > 0.005 ? fmtUSD(value) : value > 0 ? fmtUSD(value, 2) : "--"}</TableCell>
                      <TableCell className="text-right tabular text-muted-foreground">{fmtPct(pctOfAcct)}</TableCell>
                      <TableCell className="text-right tabular">{h.quantity.toLocaleString("en-US")}</TableCell>
                      <TableCell className="text-right tabular">{fmtUSD(h.cost_basis, 2)}</TableCell>
                      <TableCell className="text-right tabular">{fmtUSD(cost)}</TableCell>
                      <TableCell className="w-8 p-1" onClick={(e) => e.stopPropagation()}>
                        <ThesisDialog holding={h} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {/* Fidelity-style account summary footer */}
            <div className="mt-3 divide-y border-t text-sm">
              <div className="flex items-center justify-between py-2">
                <span className="font-semibold uppercase tracking-wide text-muted-foreground">Total</span>
                <span className="flex gap-6 tabular">
                  <span className={pl >= 0 ? "text-success" : "text-destructive"}>{fmtUSD(pl)}</span>
                  <span className="font-medium">{fmtUSD(positionsValue)}</span>
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="font-semibold uppercase tracking-wide text-muted-foreground">Pending activity</span>
                <span className="tabular">{fmtUSD(-Number(amirAccount?.margin_used ?? 0))}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="font-semibold uppercase tracking-wide">Total account value</span>
                <span className="tabular font-semibold">
                  {fmtUSD(positionsValue + Number(amirAccount?.cash ?? 0) - Number(amirAccount?.margin_used ?? 0))}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="font-semibold uppercase tracking-wide text-muted-foreground">Today's change</span>
                <span className="tabular">
                  {(() => {
                    const day = liveHoldings.reduce((sum, h) => {
                      const q = liveQuotes?.[h.symbol];
                      return q && q.prevClose > 0 ? sum + h.quantity * (q.price - q.prevClose) : sum;
                    }, 0);
                    const net = positionsValue + Number(amirAccount?.cash ?? 0) - Number(amirAccount?.margin_used ?? 0);
                    const prior = net - day; // Fidelity: % vs yesterday's account value
                    return (
                      <span className={day >= 0 ? "text-success" : "text-destructive"}>
                        {day >= 0 ? "+" : ""}{fmtUSD(day)} ({prior > 0 ? fmtPct(day / prior) : "—"})
                      </span>
                    );
                  })()}
                </span>
              </div>
              <p className="pt-2 text-[11px] text-muted-foreground">
                <span className="align-super text-[9px]">t</span> Not priced today — last known price shown; excluded from Today&apos;s G/L.
              </p>
            </div>
            </>
          )}
        </div>

        <div className="rounded-2xl border bg-card p-5">
          <div className="mb-3 text-sm font-medium">Sector allocation</div>
          {sectorData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={sectorData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {sectorData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      color: "var(--color-popover-foreground)",
                    }}
                    formatter={(v: number) => fmtUSD(v)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: "var(--color-muted-foreground)" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium">Cash & margin</div>
          <span className="text-xs text-muted-foreground">User-entered</span>
        </div>
        <AccountForm account={account} onSave={(patch) => upsert.mutate(patch, { onSuccess: () => toast.success("Saved") })} />
      </div>



      {/* Position detail drawer */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          {selected && (
            <PositionDetail
              holding={selected}
              onSaved={() => { setSelected(null); qc.invalidateQueries({ queryKey: ["holdings"] }); }}
              onDeleted={() => { setSelected(null); qc.invalidateQueries({ queryKey: ["holdings"] }); }}
            />
          )}
        </SheetContent>
      </Sheet>
          <div className="mt-4 rounded-2xl border bg-card p-5">
        <div className="mb-3 text-sm font-medium">Sector allocation</div>
        {(() => {
          const total = liveHoldings.reduce((s2, h) => s2 + h.quantity * h.current_price, 0);
          const bySector = new Map<string, number>();
          for (const h of liveHoldings) {
            const k = sectorFor(h.symbol, h.sector);
            bySector.set(k, (bySector.get(k) ?? 0) + h.quantity * h.current_price);
          }
          const rows = [...bySector.entries()].sort((a, b) => b[1] - a[1]);
          if (total <= 0) return <p className="text-sm text-muted-foreground">No positions.</p>;
          return (
            <div className="space-y-2">
              {rows.map(([sector, v]) => (
                <div key={sector} className="flex items-center gap-3 text-sm">
                  <span className="w-40 truncate">{sector}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${Math.max(2, (v / total) * 100)}%` }} />
                  </div>
                  <span className="w-28 text-right tabular-nums text-muted-foreground">
                    {fmtUSD(v)} · {fmtPct(v / total)}
                  </span>
                </div>
              ))}
              {bySector.has("Unclassified") && (
                <p className="text-[11px] text-muted-foreground">
                  Unclassified symbols can be assigned via the 📄 button on the holding.
                </p>
              )}
            </div>
          );
        })()}
      </div>
    </AppShell>
  );
}

function AccountForm({
  account,
  onSave,
}: {
  account: { cash: number; margin_used: number; margin_limit: number; buying_power: number } | null | undefined;
  onSave: (patch: Record<string, number>) => void;
}) {
  const [cash, setCash] = useState(account?.cash ?? 0);
  const [used, setUsed] = useState(account?.margin_used ?? 0);
  const [limit, setLimit] = useState(account?.margin_limit ?? 0);
  const [bp, setBp] = useState(account?.buying_power ?? 0);
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <div>
        <Label className="text-xs">Cash</Label>
        <Input type="number" value={cash} onChange={(e) => setCash(+e.target.value)} />
      </div>
      <div>
        <Label className="text-xs">Margin used</Label>
        <Input type="number" value={used} onChange={(e) => setUsed(+e.target.value)} />
      </div>
      <div>
        <Label className="text-xs">Margin limit</Label>
        <Input type="number" value={limit} onChange={(e) => setLimit(+e.target.value)} />
      </div>
      <div>
        <Label className="text-xs">Buying power</Label>
        <Input type="number" value={bp} onChange={(e) => setBp(+e.target.value)} />
      </div>
      <div className="md:col-span-4">
        <Button
          size="sm"
          onClick={() =>
            onSave({
              cash,
              margin_used: used,
              margin_limit: limit,
              buying_power: bp,
              last_synced_at: new Date().toISOString() as unknown as number,
            })
          }
        >
          <Save className="mr-2 h-4 w-4" /> Save
        </Button>
      </div>
    </div>
  );
}

function PositionDetail({
  holding,
  onSaved,
  onDeleted,
}: {
  holding: Holding;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [h, setH] = useState(holding);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("holdings")
      .update({
        quantity: h.quantity,
        cost_basis: h.cost_basis,
        current_price: h.current_price,
        sector: h.sector,
        original_thesis: h.original_thesis,
        current_thesis: h.current_thesis,
        why_own: h.why_own,
        notes: h.notes,
        last_ai_review: h.last_ai_review,
        last_reviewed_at: new Date().toISOString(),
        last_price_at: new Date().toISOString(),
      })
      .eq("id", h.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    onSaved();
  };
  const del = async () => {
    if (!confirm(`Delete ${h.symbol}?`)) return;
    const { error } = await supabase.from("holdings").delete().eq("id", h.id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    onDeleted();
  };
  return (
    <div className="space-y-4 pb-8">
      <SheetHeader>
        <SheetTitle className="text-2xl">{h.symbol}</SheetTitle>
        <SheetDescription>
          {fmtUSD(h.quantity * h.current_price)} · cost {fmtUSD(h.cost_basis, 2)}/sh
        </SheetDescription>
      </SheetHeader>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">Qty</Label>
          <Input type="number" value={h.quantity} onChange={(e) => setH({ ...h, quantity: +e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Cost</Label>
          <Input type="number" value={h.cost_basis} onChange={(e) => setH({ ...h, cost_basis: +e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Price</Label>
          <Input type="number" value={h.current_price} onChange={(e) => setH({ ...h, current_price: +e.target.value })} />
        </div>
      </div>
      <div>
        <Label className="text-xs">Sector</Label>
        <Input value={h.sector ?? ""} onChange={(e) => setH({ ...h, sector: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">Original thesis</Label>
        <Textarea rows={2} value={h.original_thesis ?? ""} onChange={(e) => setH({ ...h, original_thesis: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">Current thesis</Label>
        <Textarea rows={2} value={h.current_thesis ?? ""} onChange={(e) => setH({ ...h, current_thesis: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">Why I own it</Label>
        <Textarea rows={2} value={h.why_own ?? ""} onChange={(e) => setH({ ...h, why_own: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">Last AI review</Label>
        <Textarea rows={3} value={h.last_ai_review ?? ""} onChange={(e) => setH({ ...h, last_ai_review: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">My notes</Label>
        <Textarea rows={3} value={h.notes ?? ""} onChange={(e) => setH({ ...h, notes: e.target.value })} />
      </div>
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving} className="flex-1">
          <Save className="mr-2 h-4 w-4" /> {saving ? "Saving..." : "Save"}
        </Button>
        <Button variant="outline" onClick={del}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

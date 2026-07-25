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
  const holdings = amirAccount
    ? allHoldings.filter((h) => h.account_id === amirAccount.id)
    : allHoldings.filter((h) => h.account_id == null);
  const { data: account, upsert } = useAccount();
  const logSync = useLogSync();
  const [selected, setSelected] = useState<Holding | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const positionsValue = holdings.reduce((s, h) => s + h.quantity * h.current_price, 0);
  const costBasis = holdings.reduce((s, h) => s + h.quantity * h.cost_basis, 0);
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
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add position
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
        <StatCard
          label="Margin loan"
          value={fmtUSD(Number(amirAccount?.margin_used ?? 0))}
          hint={Number(amirAccount?.margin_used ?? 0) > 0 ? "Owed to Fidelity at 11.825% APR" : "Set in Settings → Amir - TOD"}
          tone={Number(amirAccount?.margin_used ?? 0) > 0 ? "warning" : "default"}
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
              <span className="text-xs text-muted-foreground">Amir - TOD only</span>
              <RefreshPricesButton symbols={holdings.map((h) => h.symbol)} />
            </span>
          </div>
          {holdings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No holdings yet. Click "Add position" or import from Fidelity in Settings.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">P/L</TableHead>
                  <TableHead>Sector</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holdings.map((h) => {
                  const value = h.quantity * h.current_price;
                  const cost = h.quantity * h.cost_basis;
                  const plRow = value - cost;
                  return (
                    <TableRow
                      key={h.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(h)}
                    >
                      <TableCell className="font-medium">{h.symbol}</TableCell>
                      <TableCell className="text-right tabular">{h.quantity}</TableCell>
                      <TableCell className="text-right tabular">{fmtUSD(h.cost_basis, 2)}</TableCell>
                      <TableCell className="text-right tabular">{fmtUSD(h.current_price, 2)}</TableCell>
                      <TableCell className="text-right tabular">{fmtUSD(value)}</TableCell>
                      <TableCell className={`text-right tabular ${plRow >= 0 ? "text-success" : "text-destructive"}`}>
                        {fmtUSD(plRow)} ({cost > 0 ? fmtPct(plRow / cost) : "—"})
                      </TableCell>
                      <TableCell className="w-8 p-1">
                        <ThesisDialog holding={h} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{h.sector ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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

      {/* Add position dialog */}
      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Add position</SheetTitle>
            <SheetDescription>Enter what you own. Update the price manually or via CSV import.</SheetDescription>
          </SheetHeader>
          <AddPositionForm onSaved={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ["holdings"] }); }} />
        </SheetContent>
      </Sheet>

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
          const total = holdings.reduce((s2, h) => s2 + h.quantity * h.current_price, 0);
          const bySector = new Map<string, number>();
          for (const h of holdings) {
            const k = h.sector?.trim() || "Unclassified";
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
                  Set sectors via the 📄 button on each holding — allocation sharpens as you classify.
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

function AddPositionForm({ onSaved }: { onSaved: () => void }) {
  const [symbol, setSymbol] = useState("");
  const [qty, setQty] = useState(0);
  const [cost, setCost] = useState(0);
  const [price, setPrice] = useState(0);
  const [sector, setSector] = useState("");
  const [thesis, setThesis] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!symbol.trim()) return toast.error("Symbol required");
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("holdings").insert({
      user_id: userData.user!.id,
      symbol: symbol.trim().toUpperCase(),
      quantity: qty,
      cost_basis: cost,
      current_price: price,
      sector: sector || null,
      original_thesis: thesis || null,
      current_thesis: thesis || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Position added");
    onSaved();
  };
  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Symbol</Label>
          <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="AAPL" />
        </div>
        <div>
          <Label className="text-xs">Sector</Label>
          <Input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Technology" />
        </div>
        <div>
          <Label className="text-xs">Quantity</Label>
          <Input type="number" value={qty} onChange={(e) => setQty(+e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Cost basis</Label>
          <Input type="number" value={cost} onChange={(e) => setCost(+e.target.value)} />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Current price</Label>
          <Input type="number" value={price} onChange={(e) => setPrice(+e.target.value)} />
        </div>
      </div>
      <div>
        <Label className="text-xs">Original thesis</Label>
        <Textarea value={thesis} onChange={(e) => setThesis(e.target.value)} rows={3} placeholder="Why you bought this…" />
      </div>
      <Button onClick={submit} disabled={saving} className="w-full">
        {saving ? "Saving..." : "Add position"}
      </Button>
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

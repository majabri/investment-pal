import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Upload, LogOut } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  usePriorities,
  useRecommendedActions,
  useSyncLog,
  useLogSync,
} from "@/hooks/useAppData";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Investment Companion" },
      { name: "description", content: "Priorities, actions, and Fidelity sync." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const { data: priorities = [], add: addPriority, dismiss: dismissP } = usePriorities();
  const { data: actions = [], add: addAction, dismiss: dismissA } = useRecommendedActions();
  const { data: syncs = [] } = useSyncLog();
  const logSync = useLogSync();

  const [pLabel, setPLabel] = useState("");
  const [pSev, setPSev] = useState<"info" | "warning" | "critical">("info");

  const [aCat, setACat] = useState<"review" | "buy" | "hold" | "reduce" | "watch">("review");
  const [aSym, setASym] = useState("");
  const [aRat, setARat] = useState("");

  const [csv, setCsv] = useState("");

  const importCsv = async () => {
    // very tolerant: symbol,qty,cost,price[,sector]
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.toLowerCase().startsWith("symbol"));
    if (!lines.length) return toast.error("Nothing to import");
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user!.id;
    let ok = 0;
    for (const line of lines) {
      const parts = line.split(",").map((p) => p.trim());
      const [symbol, qty, cost, price, sector] = parts;
      if (!symbol) continue;
      const { error } = await supabase.from("holdings").upsert(
        {
          user_id: uid,
          symbol: symbol.toUpperCase(),
          quantity: +qty || 0,
          cost_basis: +cost || 0,
          current_price: +price || 0,
          sector: sector || null,
          last_price_at: new Date().toISOString(),
        },
        { onConflict: "user_id,symbol" },
      );
      if (!error) ok++;
    }
    setCsv("");
    logSync.mutate({ detail: `CSV import — ${ok} rows`, source: "manual" });
    qc.invalidateQueries({ queryKey: ["holdings"] });
    toast.success(`Imported ${ok} rows`);
  };

  return (
    <AppShell title="Settings" subtitle="Priorities, actions, brokerage sync.">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium">Today's priorities</div>
            <span className="text-xs text-muted-foreground">Shown on Dashboard</span>
          </div>
          <div className="mb-3 flex gap-2">
            <Input placeholder="e.g., NVDA earnings tomorrow" value={pLabel} onChange={(e) => setPLabel(e.target.value)} />
            <Select value={pSev} onValueChange={(v) => setPSev(v as typeof pSev)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="icon"
              onClick={() => {
                if (!pLabel.trim()) return;
                addPriority.mutate(
                  { label: pLabel, severity: pSev },
                  { onSuccess: () => setPLabel("") },
                );
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <ul className="space-y-2">
            {priorities.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <Badge variant="outline">{p.severity}</Badge>
                  {p.label}
                </span>
                <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => dismissP.mutate(p.id)}>
                  Remove
                </button>
              </li>
            ))}
            {priorities.length === 0 && <li className="text-sm text-muted-foreground">No priorities.</li>}
          </ul>
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <div className="mb-3 text-sm font-medium">Recommended actions</div>
          <div className="mb-3 grid gap-2 sm:grid-cols-[110px_120px_1fr_auto]">
            <Select value={aCat} onValueChange={(v) => setACat(v as typeof aCat)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="review">Review</SelectItem>
                <SelectItem value="buy">Buy</SelectItem>
                <SelectItem value="hold">Hold</SelectItem>
                <SelectItem value="reduce">Reduce</SelectItem>
                <SelectItem value="watch">Watch</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Symbol" value={aSym} onChange={(e) => setASym(e.target.value.toUpperCase())} />
            <Input placeholder="Rationale" value={aRat} onChange={(e) => setARat(e.target.value)} />
            <Button
              size="icon"
              onClick={() => {
                addAction.mutate(
                  { category: aCat, symbol: aSym || null, rationale: aRat || null },
                  { onSuccess: () => { setASym(""); setARat(""); } },
                );
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <ul className="space-y-2">
            {actions.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                <span>
                  <Badge variant="outline" className="mr-2">{a.category}</Badge>
                  {a.symbol ? <span className="font-medium">{a.symbol}</span> : null}
                  {a.rationale ? <span className="ml-2 text-muted-foreground">— {a.rationale}</span> : null}
                </span>
                <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => dismissA.mutate(a.id)}>
                  Remove
                </button>
              </li>
            ))}
            {actions.length === 0 && <li className="text-sm text-muted-foreground">No actions.</li>}
          </ul>
        </section>
      </div>

      <section className="mt-4 rounded-2xl border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Fidelity sync</div>
            <p className="text-xs text-muted-foreground">
              Direct read-only connection isn't wired yet. Paste CSV rows (symbol,qty,cost,price,sector) to update holdings.
              Direct integration will slot in behind this same sync UI when available.
            </p>
          </div>
        </div>
        <Textarea
          rows={6}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={`AAPL,50,150.25,225.10,Technology\nNVDA,20,420,480,Technology`}
          className="font-mono text-xs"
        />
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={importCsv}>
            <Upload className="mr-2 h-4 w-4" /> Import CSV
          </Button>
          <span className="text-xs text-muted-foreground">Existing symbols are updated in place.</span>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border bg-card p-5">
        <div className="mb-3 text-sm font-medium">Recent syncs</div>
        {syncs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No syncs yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {syncs.map((s) => (
              <li key={s.id} className="flex justify-between border-b py-1 last:border-0">
                <span className="text-muted-foreground">
                  {formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}
                </span>
                <span>{s.detail ?? s.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4 rounded-2xl border bg-card p-5">
        <div className="mb-3 text-sm font-medium">Account</div>
        <Button variant="outline" onClick={() => supabase.auth.signOut()}>
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </Button>
      </section>
    </AppShell>
  );
}

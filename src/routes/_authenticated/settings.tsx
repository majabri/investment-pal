import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Upload, LogOut, Trash2, Pencil, Check, X } from "lucide-react";
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
  useAccounts,
  type Account,
} from "@/hooks/useAppData";
import { useQueryClient } from "@tanstack/react-query";
import { parsePositionsCsv } from "@/lib/csvImport";
import { fmtUSD } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Investment Companion" },
      { name: "description", content: "Accounts, targets, priorities, and imports." },
    ],
  }),
  component: SettingsPage,
});

const ACCOUNT_TYPES = [
  "brokerage",
  "ira",
  "roth_ira",
  "401k",
  "hsa",
  "custodial",
  "trust",
  "cash",
  "other",
] as const;

function SettingsPage() {
  const qc = useQueryClient();
  const { data: priorities = [], add: addPriority, dismiss: dismissP } = usePriorities();
  const { data: actions = [], add: addAction, dismiss: dismissA } = useRecommendedActions();
  const { data: syncs = [] } = useSyncLog();
  const logSync = useLogSync();
  const { data: accounts = [], create: createAccount } = useAccounts();

  const [pLabel, setPLabel] = useState("");
  const [pSev, setPSev] = useState<"info" | "warning" | "critical">("info");
  const [aCat, setACat] = useState<"review" | "buy" | "hold" | "reduce" | "watch">("review");
  const [aSym, setASym] = useState("");
  const [aRat, setARat] = useState("");
  const [newAcctName, setNewAcctName] = useState("");
  const [newAcctType, setNewAcctType] = useState<string>("brokerage");

  return (
    <AppShell title="Settings" subtitle="Accounts, targets, priorities, and imports.">
      {/* ACCOUNTS */}
      <section className="rounded-2xl border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Accounts</div>
            <p className="text-xs text-muted-foreground">
              Add each brokerage or retirement account. Set a target value and date per account —
              the app will track progress independently.
            </p>
          </div>
        </div>

        <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px_auto]">
          <Input
            placeholder="Account name (e.g., Amir-TOD, Roth IRA, Kids UTMA)"
            value={newAcctName}
            onChange={(e) => setNewAcctName(e.target.value)}
          />
          <Select value={newAcctType} onValueChange={setNewAcctType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t.replace("_", " ").toUpperCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => {
              const name = newAcctName.trim();
              if (!name) return toast.error("Name required");
              createAccount.mutate(
                { name, account_type: newAcctType },
                {
                  onSuccess: () => {
                    setNewAcctName("");
                    toast.success("Account added");
                  },
                  onError: (e) => toast.error((e as Error).message),
                },
              );
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Add account
          </Button>
        </div>

        <div className="space-y-3">
          {accounts.length === 0 && (
            <p className="text-sm text-muted-foreground">No accounts yet. Add one above.</p>
          )}
          {accounts.map((a) => (
            <AccountCard key={a.id} account={a} onSynced={() => qc.invalidateQueries({ queryKey: ["sync_log"] })} />
          ))}
        </div>
      </section>

      {/* PRIORITIES + ACTIONS */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
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

function AccountCard({ account, onSynced }: { account: Account; onSynced: () => void }) {
  const qc = useQueryClient();
  const { update, remove } = useAccounts();
  const logSync = useLogSync();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: account.name,
    account_type: account.account_type,
    broker: account.broker ?? "",
    starting_value: account.starting_value ?? 0,
    target_value: account.target_value ?? 0,
    target_date: account.target_date ?? "",
    cash: account.cash ?? 0,
    margin_used: account.margin_used ?? 0,
    margin_limit: account.margin_limit ?? 0,
    buying_power: account.buying_power ?? 0,
    notes: account.notes ?? "",
  });
  const [csv, setCsv] = useState("");
  const [importing, setImporting] = useState(false);
  const [mode, setMode] = useState<"replace" | "merge">("replace");

  const save = () => {
    update.mutate(
      {
        id: account.id,
        name: form.name,
        account_type: form.account_type,
        broker: form.broker || null,
        starting_value: Number(form.starting_value) || 0,
        target_value: form.target_value ? Number(form.target_value) : null,
        target_date: form.target_date || null,
        cash: Number(form.cash) || 0,
        margin_used: Number(form.margin_used) || 0,
        margin_limit: Number(form.margin_limit) || 0,
        buying_power: Number(form.buying_power) || 0,
        notes: form.notes || null,
      },
      {
        onSuccess: () => {
          toast.success("Account saved");
          setEditing(false);
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const importCsv = async () => {
    if (!csv.trim()) return toast.error("Paste CSV data first");
    setImporting(true);
    try {
      const { rows, skipped } = parsePositionsCsv(csv);
      if (!rows.length) {
        toast.error(
          skipped.length
            ? `No holdings parsed. First skip: ${skipped[0].reason}`
            : "No holdings parsed",
        );
        return;
      }
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user!.id;

      if (mode === "replace") {
        const { error: delErr } = await supabase
          .from("holdings")
          .delete()
          .eq("account_id", account.id);
        if (delErr) throw delErr;
      }

      const payload = rows.map((r) => ({
        user_id: uid,
        account_id: account.id,
        symbol: r.symbol,
        quantity: r.quantity,
        cost_basis: r.cost_basis,
        current_price: r.current_price,
        sector: r.sector,
        last_price_at: new Date().toISOString(),
      }));

      const { error: insErr } = await supabase
        .from("holdings")
        .upsert(payload, { onConflict: "user_id,account_id,symbol" });
      if (insErr) throw insErr;

      await supabase
        .from("accounts")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", account.id);

      logSync.mutate({
        detail: `Imported ${rows.length} rows into ${account.name}${skipped.length ? ` (${skipped.length} skipped)` : ""}`,
        source: "csv",
      });
      qc.invalidateQueries({ queryKey: ["holdings"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setCsv("");
      onSynced();
      toast.success(
        `Imported ${rows.length} positions${skipped.length ? ` — ${skipped.length} skipped` : ""}`,
      );
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="rounded-xl border bg-background/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{account.name}</span>
            <Badge variant="outline" className="text-[10px] uppercase">
              {account.account_type.replace("_", " ")}
            </Badge>
            {account.broker && (
              <span className="text-xs text-muted-foreground">{account.broker}</span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Cash {fmtUSD(account.cash)} · BP {fmtUSD(account.buying_power)}
            {account.target_value ? (
              <>
                {" · Target "}
                {fmtUSD(account.target_value)}
                {account.target_date ? ` by ${account.target_date}` : ""}
              </>
            ) : (
              " · No target set"
            )}
            {account.last_synced_at && (
              <> · Last sync {formatDistanceToNow(new Date(account.last_synced_at), { addSuffix: true })}</>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <Button size="icon" variant="ghost" onClick={save}><Check className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => setEditing(false)}><X className="h-4 w-4" /></Button>
            </>
          ) : (
            <Button size="icon" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              if (confirm(`Delete "${account.name}"? This removes its holdings too.`)) {
                remove.mutate(account.id, {
                  onSuccess: () => toast.success("Account deleted"),
                  onError: (e) => toast.error((e as Error).message),
                });
              }
            }}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      {editing && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Type">
            <Select
              value={form.account_type}
              onValueChange={(v) => setForm({ ...form, account_type: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t.replace("_", " ").toUpperCase()}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Broker">
            <Input value={form.broker} onChange={(e) => setForm({ ...form, broker: e.target.value })} placeholder="Fidelity" />
          </Field>
          <Field label="Starting value ($)">
            <Input type="number" value={form.starting_value} onChange={(e) => setForm({ ...form, starting_value: +e.target.value })} />
          </Field>
          <Field label="Target value ($)">
            <Input type="number" value={form.target_value} onChange={(e) => setForm({ ...form, target_value: +e.target.value })} />
          </Field>
          <Field label="Target date">
            <Input type="date" value={form.target_date ?? ""} onChange={(e) => setForm({ ...form, target_date: e.target.value })} />
          </Field>
          <Field label="Cash ($)">
            <Input type="number" value={form.cash} onChange={(e) => setForm({ ...form, cash: +e.target.value })} />
          </Field>
          <Field label="Buying power ($)">
            <Input type="number" value={form.buying_power} onChange={(e) => setForm({ ...form, buying_power: +e.target.value })} />
          </Field>
          <Field label="Margin used ($)">
            <Input type="number" value={form.margin_used} onChange={(e) => setForm({ ...form, margin_used: +e.target.value })} />
          </Field>
          <Field label="Margin limit ($)">
            <Input type="number" value={form.margin_limit} onChange={(e) => setForm({ ...form, margin_limit: +e.target.value })} />
          </Field>
          <Field label="Notes" className="sm:col-span-2 lg:col-span-3">
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
      )}

      <div className="mt-4 rounded-lg border bg-card/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium">Import positions CSV</div>
          <Select value={mode} onValueChange={(v) => setMode(v as "replace" | "merge")}>
            <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="replace">Replace all in account</SelectItem>
              <SelectItem value="merge">Merge / update</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="mb-2 text-[11px] text-muted-foreground">
          Paste the Fidelity Positions export (with header row) or simple <code>symbol,qty,cost,price[,sector]</code> lines.
        </p>
        <Textarea
          rows={5}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={`Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total,Average Cost Basis,Type\nAAPL,APPLE INC,50,$225.10,$11255.00,$7512.50,$150.25,Cash`}
          className="font-mono text-[11px]"
        />
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" onClick={importCsv} disabled={importing}>
            <Upload className="mr-2 h-4 w-4" />
            {importing ? "Importing…" : "Import CSV"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {mode === "replace" ? "Deletes existing holdings in this account first." : "Adds new symbols and updates existing."}
          </span>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

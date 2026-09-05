import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Upload, LogOut, Trash2, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

import { AppShell } from "@/components/app/AppShell";
import { BalanceImport } from "@/components/app/BalanceImport";
import { PortfolioCsvImport } from "@/components/app/PortfolioCsvImport";
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
import { IpsLiteCard, MarginRateCard, ObjectiveCard } from "@/components/app/settings/PolicyCards";
import { supabase } from "@/lib/supabaseClient";
import {
  usePriorities,
  useRecommendedActions,
  useSyncLog,
  useLogSync,
  useAccounts,
  useGoal,
  useIpsLite,
  type Account,
} from "@/hooks/useAppData";
import { useQueryClient } from "@tanstack/react-query";
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

  const { data: accounts = [], create: createAccount } = useAccounts();
  // The policy editors take their record and loading flag as props: the load
  // window is a money-adjacent hazard (see PolicyCards) and the guard is
  // easier to test when the components do not fetch for themselves.
  const { data: ips, isLoading: ipsLoading, save: saveIps } = useIpsLite();
  const { data: goal, isLoading: goalLoading, isError: goalError, update: updateGoal } = useGoal();

  const [pLabel, setPLabel] = useState("");
  const [pSev, setPSev] = useState<"info" | "warning" | "critical">("info");
  const [aCat, setACat] = useState<"review" | "buy" | "hold" | "reduce" | "watch">("review");
  const [aSym, setASym] = useState("");
  const [aRat, setARat] = useState("");
  const [newAcctName, setNewAcctName] = useState("");
  const [newAcctType, setNewAcctType] = useState<string>("brokerage");

  return (
    <AppShell title="Settings" subtitle="Accounts, targets, priorities, and imports.">
      <div className="mb-4">
        <PortfolioCsvImport />
      </div>
      {/* Positions come in as a CSV; the balances beside them come in as the
          pasted block. Both are imports, so they sit together. */}
      <div className="mb-4">
        <BalanceImport />
      </div>
      <ObjectiveCard goal={goal} isLoading={goalLoading} isError={goalError} update={updateGoal} />
      <IpsLiteCard ips={ips} isLoading={ipsLoading} save={saveIps} />
      <MarginRateCard ips={ips} isLoading={ipsLoading} save={saveIps} />
      {/* ACCOUNTS */}
      <section className="rounded-2xl border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Accounts</div>
            <AddAccountForm />
            <p className="text-xs text-muted-foreground">
              Add each brokerage or retirement account. Set a target value and date per account —
              the app will track progress independently.
            </p>
          </div>
        </div>

        <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px_auto]">
          <Input
            placeholder="Account name (e.g., Brokerage, Roth IRA, Kids UTMA)"
            value={newAcctName}
            onChange={(e) => setNewAcctName(e.target.value)}
          />
          <Select value={newAcctType} onValueChange={setNewAcctType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.replace("_", " ").toUpperCase()}
                </SelectItem>
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
            <AccountCard
              key={a.id}
              account={a}
              onSynced={() => qc.invalidateQueries({ queryKey: ["sync_log"] })}
            />
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
            <Input
              placeholder="e.g., NVDA earnings tomorrow"
              value={pLabel}
              onChange={(e) => setPLabel(e.target.value)}
            />
            <Select value={pSev} onValueChange={(v) => setPSev(v as typeof pSev)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
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
              <li
                key={p.id}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <Badge variant="outline">{p.severity}</Badge>
                  {p.label}
                </span>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => dismissP.mutate(p.id)}
                >
                  Remove
                </button>
              </li>
            ))}
            {priorities.length === 0 && (
              <li className="text-sm text-muted-foreground">No priorities.</li>
            )}
          </ul>
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <div className="mb-3 text-sm font-medium">Recommended actions</div>
          <div className="mb-3 grid gap-2 sm:grid-cols-[110px_120px_1fr_auto]">
            <Select value={aCat} onValueChange={(v) => setACat(v as typeof aCat)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="review">Review</SelectItem>
                <SelectItem value="buy">Buy</SelectItem>
                <SelectItem value="hold">Hold</SelectItem>
                <SelectItem value="reduce">Reduce</SelectItem>
                <SelectItem value="watch">Watch</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Symbol"
              value={aSym}
              onChange={(e) => setASym(e.target.value.toUpperCase())}
            />
            <Input placeholder="Rationale" value={aRat} onChange={(e) => setARat(e.target.value)} />
            <Button
              size="icon"
              onClick={() => {
                addAction.mutate(
                  { category: aCat, symbol: aSym || null, rationale: aRat || null },
                  {
                    onSuccess: () => {
                      setASym("");
                      setARat("");
                    },
                  },
                );
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <ul className="space-y-2">
            {actions.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
              >
                <span>
                  <Badge variant="outline" className="mr-2">
                    {a.category}
                  </Badge>
                  {a.symbol ? <span className="font-medium">{a.symbol}</span> : null}
                  {a.rationale ? (
                    <span className="ml-2 text-muted-foreground">— {a.rationale}</span>
                  ) : null}
                </span>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => dismissA.mutate(a.id)}
                >
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
    cash: account.cash ?? 0,
    margin_used: account.margin_used ?? 0,
    margin_limit: account.margin_limit ?? 0,
    buying_power: account.buying_power ?? 0,
    notes: account.notes ?? "",
  });

  const save = () => {
    update.mutate(
      {
        id: account.id,
        name: form.name,
        account_type: form.account_type,
        broker: form.broker || null,
        // starting_value / target_value / target_date are deliberately NOT
        // written. They are a second objective that nothing in the app reads —
        // the dashboard, the goal screen and the committee prompt all read the
        // `goals` row. Editing them here looked like setting a target and set
        // nothing. See the Objective card above.
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
            {/* A target recorded on the account itself is shown as what it is:
                a leftover that nothing reads. Hiding it would make the value
                vanish silently; presenting it as "Target" implied it drove
                something. The objective the app actually uses is the goal. */}
            {account.target_value ? (
              <>
                {" · unused account target "}
                {fmtUSD(account.target_value)}
                {account.target_date ? ` by ${account.target_date}` : ""}
              </>
            ) : null}
            {account.last_synced_at && (
              <>
                {" "}
                · Last sync{" "}
                {formatDistanceToNow(new Date(account.last_synced_at), { addSuffix: true })}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <Button size="icon" variant="ghost" onClick={save}>
                <Check className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => setEditing(false)}>
                <X className="h-4 w-4" />
              </Button>
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
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.replace("_", " ").toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Broker">
            <Input
              value={form.broker}
              onChange={(e) => setForm({ ...form, broker: e.target.value })}
              placeholder="Fidelity"
            />
          </Field>
          <Field label="Cash ($)">
            <Input
              type="number"
              value={form.cash}
              onChange={(e) => setForm({ ...form, cash: +e.target.value })}
            />
          </Field>
          <Field label="Buying power ($)">
            <Input
              type="number"
              value={form.buying_power}
              onChange={(e) => setForm({ ...form, buying_power: +e.target.value })}
            />
          </Field>
          <Field label="Margin used ($)">
            <Input
              type="number"
              value={form.margin_used}
              onChange={(e) => setForm({ ...form, margin_used: +e.target.value })}
            />
          </Field>
          <Field label="Margin limit ($)">
            <Input
              type="number"
              value={form.margin_limit}
              onChange={(e) => setForm({ ...form, margin_limit: +e.target.value })}
            />
          </Field>
          <Field label="Notes" className="sm:col-span-2 lg:col-span-3">
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function AddAccountForm() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Not signed in");
      const { error } = await supabase.from("accounts").insert({ user_id: auth.user.id, name: n });
      if (error) throw error;
      toast.success(`Account "${n}" added`);
      setName("");
      void qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-2 py-1">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Add account (e.g. HSA, ROTH IRA)"
        className="h-8 max-w-xs text-sm"
        onKeyDown={(e) => e.key === "Enter" && void add()}
      />
      <Button size="sm" className="h-8" disabled={busy || !name.trim()} onClick={() => void add()}>
        Add
      </Button>
    </div>
  );
}

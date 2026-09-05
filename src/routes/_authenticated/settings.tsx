import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
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
import { UNAVAILABLE, numberOrUnknown } from "@/lib/unavailable";
import { ACCOUNT_TYPES } from "@/lib/accountMetadata";
import { rateStatus } from "@/lib/marginCost";
import { isFutureLocalDate } from "@/lib/localDate";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Investment Companion" },
      { name: "description", content: "Accounts, targets, priorities, and imports." },
    ],
  }),
  component: SettingsPage,
});


// IPS-lite policy editor (ADR-APP-004). Position cap + margin cap govern the
// committee prompt and the Constitution Check strip. Money-adjacent numbers were
// signed off in ADR-APP-004; edits here re-set the policy going forward.
function IpsLiteCard() {
  const { data: ips, save } = useIpsLite();
  const [posCap, setPosCap] = useState("");
  const [marginCap, setMarginCap] = useState("");
  const [mode, setMode] = useState("soft");
  useEffect(() => {
    setPosCap(String(ips.position_cap_pct));
    setMarginCap(String(ips.margin_cap_pct));
    setMode(ips.position_cap_hard ? "hard" : "soft");
  }, [ips.position_cap_pct, ips.margin_cap_pct, ips.position_cap_hard]);

  const onSave = () => {
    const p = Number(posCap);
    const m = Number(marginCap);
    if (!Number.isFinite(p) || p < 0 || p > 100) return toast.error("Position cap must be 0–100%");
    if (!Number.isFinite(m) || m < 0 || m > 100) return toast.error("Margin cap must be 0–100%");
    save.mutate(
      { position_cap_pct: p, position_cap_hard: mode === "hard", margin_cap_pct: m },
      {
        onSuccess: () => toast.success("Policy saved"),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  return (
    <section className="mb-4 rounded-2xl border bg-card p-5">
      <div className="mb-1 text-sm font-medium">Investment policy (IPS-lite)</div>
      <p className="mb-3 text-xs text-muted-foreground">
        Governs the committee prompt and the Constitution Check strip. The objective never justifies
        overriding these limits or the evidence contract.
      </p>
      <div className="grid gap-3 sm:grid-cols-[200px_200px_160px_auto]">
        <div>
          <Label className="text-xs">Max single position (% of gross)</Label>
          <Input
            type="number"
            min={0}
            max={100}
            value={posCap}
            onChange={(e) => setPosCap(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Max margin utilization (% of acct)</Label>
          <Input
            type="number"
            min={0}
            max={100}
            value={marginCap}
            onChange={(e) => setMarginCap(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Position cap enforcement</Label>
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="soft">Soft (flag)</SelectItem>
              <SelectItem value="hard">Hard (block)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button onClick={onSave} disabled={save.isPending}>
            Save policy
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * The objective — one row, edited here and on the goal screen, read everywhere.
 *
 * Stage 4 of the 2026-09-03 brief. The objective was editable in two places
 * that were not the same place: the goal screen wrote `goals`, which the
 * dashboard, the goal screen and the committee prompt all read; the per-account
 * form below wrote `accounts.target_value` / `target_date` / `starting_value`,
 * which NOTHING read. Setting a target there looked like setting a target and
 * set nothing.
 *
 * The account-level fields are no longer written (see AccountCard). This card
 * edits the row the app actually uses, so Settings and the goal screen are two
 * views of one objective rather than two objectives.
 */
function ObjectiveCard() {
  const { data: goal, update } = useGoal();
  const [target, setTarget] = useState("");
  const [date, setDate] = useState("");
  const [starting, setStarting] = useState("");
  const [monthly, setMonthly] = useState("");

  useEffect(() => {
    if (!goal) return;
    setTarget(String(goal.target_value ?? ""));
    setDate(goal.target_date ?? "");
    setStarting(String(goal.starting_value ?? ""));
    setMonthly(String(goal.monthly_contribution ?? ""));
  }, [goal]);

  if (!goal) {
    // No goal row: say so rather than rendering a form whose save has nowhere
    // to go. Creating one from here would invent a target.
    return (
      <section className="mb-4 rounded-2xl border bg-card p-5">
        <div className="mb-1 text-sm font-medium">Objective</div>
        <p className="text-xs text-muted-foreground">
          No objective set yet. Create one on the Goal screen — the dashboard, the goal screen and
          the committee prompt all read that single row.
        </p>
      </section>
    );
  }

  const onSave = () => {
    const t = Number(target);
    const s = Number(starting);
    const m = Number(monthly);
    if (!Number.isFinite(t) || t <= 0) return toast.error("Target value must be a positive number");
    if (!Number.isFinite(s) || s < 0) return toast.error("Starting value cannot be negative");
    if (!Number.isFinite(m) || m < 0) return toast.error("Monthly contribution cannot be negative");
    if (!date) return toast.error("Set a target date");
    // Today is rejected along with the past, deliberately. A zero horizon is
    // as unusable as a negative one: `yearsBetween` clamps it to 0.01 years,
    // and every CAGR and probability figure downstream is then computed over
    // roughly three days — an absurd number rendered with full confidence.
    if (!isFutureLocalDate(date)) {
      return toast.error("The target date must be later than today");
    }
    update.mutate(
      {
        id: goal.id,
        target_value: t,
        target_date: date,
        starting_value: s,
        monthly_contribution: m,
      },
      {
        onSuccess: () => toast.success("Objective saved"),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  return (
    <section className="mb-4 rounded-2xl border bg-card p-5">
      <div className="mb-1 text-sm font-medium">Objective</div>
      <p className="mb-3 text-xs text-muted-foreground">
        One objective, read by the dashboard, the goal screen and the committee prompt. Editing it
        here and editing it on the Goal screen change the same row — there is no second copy.
      </p>
      <div className="grid gap-3 sm:grid-cols-[180px_180px_180px_180px_auto]">
        <div>
          <Label className="text-xs">Target value ($)</Label>
          {/* `min` matches the check in onSave. A browser constraint that
              disagrees with the validation produces an error message the form
              itself said was fine. */}
          <Input
            type="number"
            min={0.01}
            step="0.01"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Target date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Starting value ($)</Label>
          <Input
            type="number"
            min={0}
            value={starting}
            onChange={(e) => setStarting(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Monthly contribution ($)</Label>
          <Input
            type="number"
            min={0}
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <Button size="sm" onClick={onSave} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save objective"}
          </Button>
        </div>
      </div>
    </section>
  );
}

// Margin rate (ADR-APP-007). The rate is IPS policy, not app config, and it is
// entered here rather than committed to source: Fidelity's rate is tiered by
// debit balance and floats with the base rate, so any value baked into code is
// wrong over time. Unset is a valid, shipped state — the app suppresses the
// cost figure rather than computing with a fallback.
function MarginRateCard() {
  const { data: ips, save } = useIpsLite();
  const [rate, setRate] = useState("");
  const [asOf, setAsOf] = useState("");
  const [floating, setFloating] = useState("floating");
  const [staleDays, setStaleDays] = useState("");

  useEffect(() => {
    setRate(ips.margin_rate_annual_pct == null ? "" : String(ips.margin_rate_annual_pct));
    setAsOf(ips.margin_rate_as_of ?? "");
    setFloating(ips.margin_rate_is_floating ? "floating" : "fixed");
    setStaleDays(String(ips.margin_rate_stale_days));
  }, [
    ips.margin_rate_annual_pct,
    ips.margin_rate_as_of,
    ips.margin_rate_is_floating,
    ips.margin_rate_stale_days,
  ]);

  const status = rateStatus(ips);

  const onSave = () => {
    const trimmed = rate.trim();
    // Clearing the field un-sets the rate. That has to stay possible: if the
    // stored value is known to be wrong, "no rate" is the honest state and is
    // safer than leaving a stale number driving a cost figure.
    const r = trimmed === "" ? null : Number(trimmed);
    if (r != null && (!Number.isFinite(r) || r < 0 || r > 100)) {
      return toast.error("Margin rate must be 0–100%, or blank to clear it");
    }
    if (r != null && !asOf) {
      return toast.error("Enter the date you verified this rate");
    }
    // A malformed or future date produces a negative age in rateStatus and a
    // provenance claim the data does not support. Reject it here rather than
    // letting it reach the committee prompt.
    if (r != null) {
      const parsed = new Date(`${asOf}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime())) {
        return toast.error("Verified-on must be a real date (YYYY-MM-DD)");
      }
      // Compared as a LOCAL calendar date. `parsed > Date.now()` rejects
      // today's date for anyone east of Greenwich after their local midnight,
      // because midnight-UTC of that day has not arrived yet.
      if (isFutureLocalDate(asOf)) {
        return toast.error("Verified-on cannot be in the future");
      }
    }
    const days = Number(staleDays);
    if (!Number.isFinite(days) || days < 1) {
      return toast.error("Staleness threshold must be at least 1 day");
    }
    save.mutate(
      {
        margin_rate_annual_pct: r,
        margin_rate_as_of: r == null ? null : asOf,
        margin_rate_is_floating: floating === "floating",
        margin_rate_stale_days: Math.round(days),
      },
      {
        onSuccess: () => toast.success(r == null ? "Margin rate cleared" : "Margin rate saved"),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  return (
    <section className="mb-4 rounded-2xl border bg-card p-5">
      <div className="mb-1 text-sm font-medium">Margin rate</div>
      <p className="mb-3 text-xs text-muted-foreground">
        Your current Fidelity margin rate. Nothing in the app supplies a default: while this is
        blank, the dashboard shows no interest cost and the committee is told the rate is not set.
        Fidelity tiers by debit balance and floats with the base rate, so enter the tier that
        applies to your balance and re-check it periodically.
      </p>
      {status.kind === "stale" ? (
        <p className="mb-3 text-xs font-medium text-amber-500">
          Verified {status.ageDays} days ago — older than your {ips.margin_rate_stale_days}-day
          threshold.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[160px_180px_160px_160px_auto]">
        <div>
          <Label className="text-xs">Annual rate (%)</Label>
          <Input
            type="number"
            min={0}
            max={100}
            step="0.001"
            placeholder="not set"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Verified on</Label>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Rate type</Label>
          <Select value={floating} onValueChange={setFloating}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="floating">Floating</SelectItem>
              <SelectItem value="fixed">Fixed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Flag as stale after (days)</Label>
          <Input
            type="number"
            min={1}
            value={staleDays}
            onChange={(e) => setStaleDays(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <Button onClick={onSave} disabled={save.isPending}>
            Save rate
          </Button>
        </div>
      </div>
    </section>
  );
}

function SettingsPage() {
  const qc = useQueryClient();
  const { data: priorities = [], add: addPriority, dismiss: dismissP } = usePriorities();
  const { data: actions = [], add: addAction, dismiss: dismissA } = useRecommendedActions();
  const { data: syncs = [] } = useSyncLog();

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
      <div className="mb-4">
        <PortfolioCsvImport />
      </div>
      {/* Positions come in as a CSV; the balances beside them come in as the
          pasted block. Both are imports, so they sit together. */}
      <div className="mb-4">
        <BalanceImport />
      </div>
      <ObjectiveCard />
      <IpsLiteCard />
      <MarginRateCard />
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

/** A money field as text: empty means the figure is not known, never 0. */
const asText = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

function AccountCard({ account, onSynced }: { account: Account; onSynced: () => void }) {
  const qc = useQueryClient();
  const { update, remove } = useAccounts();
  const logSync = useLogSync();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: account.name,
    account_type: account.account_type,
    broker: account.broker ?? "",
    // Text, not `?? 0`. An unknown balance shown as 0 in the box is written to
    // the database as a real 0 by the first Save — turning "not known" into
    // "no cash" with no deliberate act (Phase 1a, rule 13). This editor was
    // missed when the Portfolio one was fixed.
    cash: asText(account.cash),
    margin_used: asText(account.margin_used),
    margin_limit: asText(account.margin_limit),
    buying_power: asText(account.buying_power),
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
        // An emptied or half-typed box clears the figure back to unknown.
        cash: numberOrUnknown(form.cash),
        margin_used: numberOrUnknown(form.margin_used),
        margin_limit: numberOrUnknown(form.margin_limit),
        buying_power: numberOrUnknown(form.buying_power),
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
              {account.account_type === null
                ? "TYPE NOT SET"
                : account.account_type.replace("_", " ")}
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
              value={form.account_type ?? ""}
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
              placeholder={UNAVAILABLE}
              onChange={(e) => setForm({ ...form, cash: e.target.value })}
            />
          </Field>
          <Field label="Buying power ($)">
            <Input
              type="number"
              value={form.buying_power}
              placeholder={UNAVAILABLE}
              onChange={(e) => setForm({ ...form, buying_power: e.target.value })}
            />
          </Field>
          <Field label="Margin used ($)">
            <Input
              type="number"
              value={form.margin_used}
              placeholder={UNAVAILABLE}
              onChange={(e) => setForm({ ...form, margin_used: e.target.value })}
            />
          </Field>
          <Field label="Margin limit ($)">
            <Input
              type="number"
              value={form.margin_limit}
              placeholder={UNAVAILABLE}
              onChange={(e) => setForm({ ...form, margin_limit: e.target.value })}
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

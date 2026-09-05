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
  useHouseholdMembers,
  useStrategies,
  useStrategySymbols,
  useGoal,
  useIpsLite,
  type Account,
} from "@/hooks/useAppData";
import { useQueryClient } from "@tanstack/react-query";
import { fmtUSD } from "@/lib/finance";
import { UNAVAILABLE, numberOrUnknown, usdOrUnavailable } from "@/lib/unavailable";
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  TAX_TREATMENTS,
  accountTypeIsConfirmed,
  unconfirmedAccounts,
} from "@/lib/accountMetadata";
import { rateStatus } from "@/lib/marginCost";
import { isFutureLocalDate, isRealCalendarDate } from "@/lib/localDate";
import { RELATIONSHIPS, ageOf } from "@/lib/household";
import { BUCKET_LABEL, STRATEGY_BUCKETS, byBucket } from "@/lib/strategy";
import {
  POLICY_CLASS_LABEL,
  POLICY_CLASS_MEANING,
  POLICY_SOURCE_LABEL,
  policyIsConfirmed,
} from "@/lib/policy";

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
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        Investment policy (IPS-lite)
        {/* Rule 21: the UI must show which KIND of rule a limit is. These two
            are the user's own risk policy — not a system safety rule the app
            enforces regardless, and not a broker or regulatory constraint the
            user could not move if they wanted to. */}
        <Badge variant="outline" className="text-[10px] uppercase">
          {POLICY_CLASS_LABEL.user_policy}
        </Badge>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Governs the committee prompt and the Constitution Check strip. The objective never justifies
        overriding these limits or the evidence contract. {POLICY_CLASS_MEANING.user_policy}
      </p>
      {/* Rule 15: a default must never masquerade as a preference. Until
          somebody saves this form, the numbers in it are ADR-APP-004's
          defaults — shown, used, and said out loud to be defaults. */}
      {!policyIsConfirmed(ips.caps_source) && (
        <p className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs">
          <span className="font-medium">{POLICY_SOURCE_LABEL[ips.caps_source]}.</span>{" "}
          {ips.caps_source === "default"
            ? "These are the app's signed-off defaults (ADR-APP-004). The dashboard flags breaches of them and the committee prompt states them, so they are doing real work — but you have not chosen them."
            : "This policy was stored before the app recorded who chose it, so it may be your decision or may be the old column defaults. Save the form to confirm."}
        </p>
      )}
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
 * As of Phase 4 the per-account fields ARE written and read — `/kids` and the
 * committee prompt take each account's own target and horizon, where they used
 * to take FAMILY_POLICY's constants (rule 20). That is a different scope, not
 * a second copy: this card edits the user's PRIMARY objective, and the account
 * editor below edits one account's own. `starting_value` is still not written
 * per account, because nothing measures an account's progress from it.
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


/**
 * Who the accounts belong to (Phase 4, rule 22).
 *
 * There is nothing here for a new user and nothing is provisioned. The list
 * this replaces was a `children` array compiled into `familyPolicy.ts` — three
 * names and birth dates, in application source — which every user of the app
 * inherited, and which no screen could tell had been made up.
 */
function HouseholdCard() {
  const { data: members = [], create, update, remove } = useHouseholdMembers();
  const [name, setName] = useState("");
  const [birth, setBirth] = useState("");
  const [rel, setRel] = useState<string>("");

  const add = () => {
    const n = name.trim();
    if (!n) return toast.error("Name required");
    // Empty box = not known, stored as NULL. Never today's date, and never a
    // placeholder: an invented birth date drives an invented age, and age
    // drives the horizon on /kids (rule 13).
    if (birth !== "" && !isRealCalendarDate(birth)) return toast.error("Birth date is not a real date");
    create.mutate(
      { display_name: n, birth_date: birth || null, relationship: rel || null },
      {
        onSuccess: () => {
          setName("");
          setBirth("");
          setRel("");
          toast.success("Member added");
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  return (
    <section className="mb-4 rounded-2xl border bg-card p-5">
      <div className="mb-1 text-sm font-medium">Household</div>
      <p className="mb-3 text-xs text-muted-foreground">
        Optional. Add people so an account can say whose it is. A birth date is only needed where
        you want age-based guidance — leave it blank and it stays unknown rather than becoming a
        guess. Nobody is added for you.
      </p>

      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_170px_150px_auto]">
        <Input
          placeholder="Name as it should appear"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />
        <Select value={rel} onValueChange={setRel}>
          <SelectTrigger>
            <SelectValue placeholder="Relationship" />
          </SelectTrigger>
          <SelectContent>
            {RELATIONSHIPS.map((r) => (
              <SelectItem key={r} value={r}>
                {r[0].toUpperCase() + r.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={add} disabled={create.isPending}>
          <Plus className="mr-2 h-4 w-4" /> Add member
        </Button>
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No household members. Custodial and family screens will say they have nothing to show
          rather than assume anyone.
        </p>
      ) : (
        <div className="space-y-2">
          {members.map((m) => {
            const age = ageOf(m.birth_date);
            return (
              <div
                key={m.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border bg-background/40 px-4 py-2 text-sm"
              >
                <span className="font-medium">{m.display_name}</span>
                <span className="text-xs text-muted-foreground">
                  {m.relationship ?? "relationship not stated"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {/* Not "age 0". A member with no birth date has an unknown
                      age, and the screens that use it must be able to see the
                      difference. */}
                  {age === null ? "birth date not set" : `age ${age}`}
                </span>
                <Input
                  type="date"
                  className="h-8 w-40 text-xs"
                  value={m.birth_date ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v !== "" && !isRealCalendarDate(v)) return;
                    update.mutate({ id: m.id, birth_date: v || null });
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-8 text-xs text-destructive"
                  onClick={() => {
                    // Accounts survive: the FK is ON DELETE SET NULL, so they
                    // become "no member linked" rather than disappearing.
                    if (!confirm(`Remove ${m.display_name}? Their accounts stay, unlinked.`)) return;
                    remove.mutate(m.id);
                  }}
                >
                  Remove
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}


/**
 * Strategy rules — the approved universe and the rules with it (Phase 4,
 * rules 16 and 21).
 *
 * `familyPolicy.ts` carried 28 tickers in four buckets, a 5% speculative cap
 * and a parity rule, compiled into the application. They drove the
 * "% in approved names" figure on /kids and an "Approved universe" paragraph
 * in the committee prompt, with nothing saying whose approval it was — and a
 * second user could change none of it without changing the source.
 */
function StrategyCard() {
  const { data: strategies = [], create, update, remove } = useStrategies();
  const { data: symbols = [], add, remove: removeSymbol } = useStrategySymbols();
  const [newName, setNewName] = useState("");
  const [sym, setSym] = useState("");
  const [bucket, setBucket] = useState<string>("core");

  const strategy = strategies[0] ?? null;
  const mine = strategy === null ? [] : symbols.filter((s) => s.strategy_id === strategy.id);

  return (
    <section className="mb-4 rounded-2xl border bg-card p-5">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        Strategy
        {/* Rule 21: a strategy rule is not the user's risk policy and not a
            system safety rule. The IPS-lite card above is the risk policy. */}
        <Badge variant="outline" className="text-[10px] uppercase">
          {POLICY_CLASS_LABEL.strategy}
        </Badge>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Optional. {POLICY_CLASS_MEANING.strategy} Nothing is approved for you — an empty universe
        means &ldquo;in approved names&rdquo; reads Unavailable rather than 0%.
      </p>

      {strategy === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="max-w-xs"
            placeholder="Strategy name (e.g. Long-term core)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button
            disabled={create.isPending}
            onClick={() => {
              const n = newName.trim();
              if (!n) return toast.error("Name required");
              create.mutate(
                { name: n },
                {
                  onSuccess: () => {
                    setNewName("");
                    toast.success("Strategy created");
                  },
                  onError: (e) => toast.error((e as Error).message),
                },
              );
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Create strategy
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                value={strategy.name}
                onChange={(e) => update.mutate({ id: strategy.id, name: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Speculative cap (%)</Label>
              <Input
                type="number"
                placeholder="No cap"
                value={
                  strategy.speculative_max_pct === null ? "" : String(strategy.speculative_max_pct)
                }
                onChange={(e) =>
                  // Empty box = no cap stated, stored as NULL. Not 0 — a cap of
                  // zero forbids speculative holdings, which is a rule, and
                  // "nobody set a cap" is not.
                  update.mutate({
                    id: strategy.id,
                    speculative_max_pct: numberOrUnknown(e.target.value),
                  })
                }
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() => {
                  if (!confirm(`Delete "${strategy.name}" and its symbols?`)) return;
                  remove.mutate(strategy.id);
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </Button>
            </div>
          </div>

          <div>
            <Label className="text-xs">Parity rule (optional, free text)</Label>
            <Textarea
              rows={2}
              placeholder="A sentence for the committee to read. Left blank, none is shown."
              defaultValue={strategy.parity_rule ?? ""}
              onBlur={(e) =>
                update.mutate({ id: strategy.id, parity_rule: e.target.value.trim() || null })
              }
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_200px_auto]">
            <Input
              placeholder="Symbol"
              value={sym}
              onChange={(e) => setSym(e.target.value.toUpperCase())}
            />
            <Select value={bucket} onValueChange={setBucket}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STRATEGY_BUCKETS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {BUCKET_LABEL[b]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              disabled={add.isPending}
              onClick={() => {
                const t = sym.trim().toUpperCase();
                if (!t) return toast.error("Symbol required");
                add.mutate(
                  { strategy_id: strategy.id, symbol: t, bucket },
                  {
                    onSuccess: () => {
                      setSym("");
                      toast.success(`${t} added`);
                    },
                    // A duplicate hits the unique index; the message says why
                    // rather than showing a Postgres constraint name.
                    onError: () =>
                      toast.error(`${t} is already in this strategy — remove it to re-bucket it`),
                  },
                );
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Add
            </Button>
          </div>

          {mine.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No symbols yet. Until there are, /kids shows Unavailable for &ldquo;in approved
              names&rdquo; and the committee prompt says no strategy is configured.
            </p>
          ) : (
            <div className="space-y-2">
              {byBucket(mine).map(([b, list]) => (
                <div key={b} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-44 shrink-0 text-xs text-muted-foreground">
                    {BUCKET_LABEL[b]}
                  </span>
                  {list.map((symbol) => {
                    const row = mine.find((m) => m.symbol === symbol)!;
                    return (
                      <button
                        key={symbol}
                        className="rounded-lg border px-2 py-0.5 text-xs hover:border-destructive hover:text-destructive"
                        title="Remove"
                        onClick={() => removeSymbol.mutate(row.id)}
                      >
                        {symbol} ×
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SettingsPage() {
  const qc = useQueryClient();
  const { data: priorities = [], add: addPriority, dismiss: dismissP } = usePriorities();
  const { data: actions = [], add: addAction, dismiss: dismissA } = useRecommendedActions();
  const { data: syncs = [] } = useSyncLog();

  const { data: accounts = [], create: createAccount } = useAccounts();
  const unconfirmed = unconfirmedAccounts(accounts);

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
      <StrategyCard />
      <HouseholdCard />
      {/* ACCOUNTS */}
      <section className="rounded-2xl border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Accounts</div>
            <AddAccountForm />
            <p className="text-xs text-muted-foreground">
              Add each brokerage or retirement account, and say what kind it is — the type and tax
              treatment decide how the account is handled, not its name.
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
          {/* Named rather than counted. "3 accounts need attention" makes the
              user hunt; the whole point is that the app is currently treating
              these specific accounts as something nobody said they were. */}
          {unconfirmed.length > 0 && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs">
              <span className="font-medium">
                {unconfirmed.length === 1 ? "One account has" : `${unconfirmed.length} accounts have`}{" "}
                a type nobody has confirmed
              </span>{" "}
              — {unconfirmed.map((a) => a.name).join(", ")}. The value was read off the account name
              or inherited from an old column default, and it decides tax treatment and which
              screens the account appears on. Open each one and confirm or correct the type.
            </div>
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
// Radix Select cannot hold "" as a value, so "not stated" needs a token. It is
// mapped back to NULL on save — the database stores absence, not a sentinel.
const NO_MEMBER = "__none__";

const asText = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

function AccountCard({ account, onSynced }: { account: Account; onSynced: () => void }) {
  const qc = useQueryClient();
  const { update, remove } = useAccounts();
  const { data: members = [] } = useHouseholdMembers();
  const logSync = useLogSync();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: account.name,
    account_type: account.account_type,
    broker: account.broker ?? "",
    tax_treatment: account.tax_treatment ?? "",
    broker_account_id: account.broker_account_id ?? "",
    currency: account.currency ?? "",
    // "" = not known, distinct from "no" — a margin figure on a cash account
    // is a data error worth catching, and it cannot be caught while "no margin"
    // and "we were not told" are the same value.
    margin_enabled: account.margin_enabled === null ? "" : account.margin_enabled ? "yes" : "no",
    account_status: account.account_status ?? "",
    // "" = nobody linked. Never defaulted to the first member: guessing who an
    // account belongs to is the same class of error as guessing what it is.
    owner_member_id: account.owner_member_id ?? "",
    // Text, not `?? 0`. An unknown balance shown as 0 in the box is written to
    // the database as a real 0 by the first Save — turning "not known" into
    // "no cash" with no deliberate act (Phase 1a, rule 13). This editor was
    // missed when the Portfolio one was fixed.
    // The account's own objective (Phase 4, rule 20). These columns existed and
    // nothing wrote them — see the note in `save` below, which this replaces.
    target_value: asText(account.target_value),
    target_date: account.target_date ?? "",
    contribution_amount: asText(account.contribution_amount),
    contribution_cadence_days: asText(account.contribution_cadence_days),
    contribution_anchor_date: account.contribution_anchor_date ?? "",
    cash: asText(account.cash),
    margin_used: asText(account.margin_used),
    margin_limit: asText(account.margin_limit),
    buying_power: asText(account.buying_power),
    notes: account.notes ?? "",
  });

  const save = () => {
    // Validate at the boundary, not only at the column. A CHECK violation
    // reaches the user as a Postgres error string; these say what is wrong.
    if (form.target_date !== "" && !isRealCalendarDate(form.target_date)) {
      return toast.error("Target date is not a real calendar date");
    }
    if (
      form.contribution_anchor_date !== "" &&
      !isRealCalendarDate(form.contribution_anchor_date)
    ) {
      return toast.error("Contribution anchor date is not a real calendar date");
    }
    const cadence = numberOrUnknown(form.contribution_cadence_days);
    // 0 never advances the schedule and a negative one walks backwards. The
    // column rejects both; this is the same rule where the user can see it.
    if (cadence !== null && (!Number.isInteger(cadence) || cadence <= 0)) {
      return toast.error("Contribution cadence must be a whole number of days above zero");
    }
    update.mutate(
      {
        id: account.id,
        name: form.name,
        account_type: form.account_type || null,
        // Saving here is a person answering. That is the whole distinction the
        // 1b migration recorded: `inferred_from_name` and `legacy_default` are
        // the app's own guesses wearing a stored value, and a guess that can
        // never be promoted to an answer is a guess forever.
        account_type_source: form.account_type ? "user_set" : null,
        tax_treatment: form.tax_treatment || null,
        broker_account_id: form.broker_account_id || null,
        currency: form.currency || null,
        margin_enabled: form.margin_enabled === "" ? null : form.margin_enabled === "yes",
        account_status: form.account_status || null,
        owner_member_id: form.owner_member_id || null,
        broker: form.broker || null,
        // target_value / target_date / the contribution plan ARE written as of
        // Phase 4. They used to be skipped because nothing read them — /kids
        // and the committee prompt used FAMILY_POLICY's constants, so every
        // user saw one household's $200,000-by-2036 target. Both now read this
        // account's own figures, and an empty box means NOT SET rather than a
        // default (rules 15, 20).
        //
        // `starting_value` is still not written: it is a `goals` concept and
        // nothing measures an account's progress from it.
        target_value: numberOrUnknown(form.target_value),
        target_date: form.target_date || null,
        contribution_amount: numberOrUnknown(form.contribution_amount),
        contribution_cadence_days: numberOrUnknown(form.contribution_cadence_days),
        contribution_anchor_date: form.contribution_anchor_date || null,
        // An emptied or half-typed box clears the figure back to unknown.
        cash: numberOrUnknown(form.cash),
        // Provenance travels with the figures (Phase 1d). Typed is a weaker
        // claim than imported and the app now says which it is holding —
        // per BLOCK, so editing one box marks all four, which is the known
        // limitation the migration records.
        balances_source_type: "user_entry",
        balances_source: "settings_form",
        balances_as_of: new Date().toISOString(),
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
            {/* A stored type is not the same as an answered one. Until someone
                confirms it, the value is the app's own guess — read off the
                account name, or inherited from a schema default nobody chose —
                and it decides tax treatment and which screens the account
                appears on. */}
            {account.account_type !== null && !accountTypeIsConfirmed(account.account_type_source) && (
              <Badge
                variant="outline"
                className="border-amber-500/50 text-[10px] uppercase text-amber-600 dark:text-amber-400"
                title={
                  account.account_type_source === "inferred_from_name"
                    ? "Guessed from the account name — confirm or correct it"
                    : "Never chosen: this is the old column default — confirm or correct it"
                }
              >
                unconfirmed
              </Badge>
            )}
            {account.broker && (
              <span className="text-xs text-muted-foreground">{account.broker}</span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Cash {usdOrUnavailable(account.cash)} · BP {usdOrUnavailable(account.buying_power)}
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
              <SelectTrigger aria-label="Account type">
                <SelectValue placeholder="Not set" />
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
          {/* A separate axis from the type on purpose: a Roth and a traditional
              IRA are both retirement accounts and are taxed oppositely, so
              deriving one from the other is the inference-from-a-label this
              phase removes. The migration deliberately left it unset for
              accounts whose name said only "IRA". */}
          <Field label="Tax treatment">
            <Select
              value={form.tax_treatment}
              onValueChange={(v) => setForm({ ...form, tax_treatment: v })}
            >
              <SelectTrigger aria-label="Tax treatment">
                <SelectValue placeholder="Not known" />
              </SelectTrigger>
              <SelectContent>
                {TAX_TREATMENTS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.replace("_", " ").toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Can borrow on margin">
            <Select
              value={form.margin_enabled}
              onValueChange={(v) => setForm({ ...form, margin_enabled: v })}
            >
              <SelectTrigger aria-label="Can borrow on margin">
                <SelectValue placeholder="Not known" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">YES</SelectItem>
                <SelectItem value="no">NO</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status">
            <Select
              value={form.account_status}
              onValueChange={(v) => setForm({ ...form, account_status: v })}
            >
              <SelectTrigger aria-label="Account status">
                <SelectValue placeholder="Not known" />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_STATUSES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Belongs to">
            <Select
              value={form.owner_member_id === "" ? NO_MEMBER : form.owner_member_id}
              onValueChange={(v) =>
                setForm({ ...form, owner_member_id: v === NO_MEMBER ? "" : v })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* First, and the shipped value for every existing row. The
                    app has never asked whose an account is, and the answer it
                    would have guessed — from the account's NAME — is the
                    defect Phase 1b removed. */}
                <SelectItem value={NO_MEMBER}>Not stated</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {members.length === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                No household members yet — add one in the Household card above.
              </p>
            )}
          </Field>
          <Field label="Currency">
            <Input
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
              placeholder="USD"
              maxLength={3}
            />
          </Field>
          <Field label="Broker account number">
            <Input
              value={form.broker_account_id}
              onChange={(e) => setForm({ ...form, broker_account_id: e.target.value })}
              placeholder="Not recorded"
            />
          </Field>
          <Field label="Broker">
            <Input
              value={form.broker}
              onChange={(e) => setForm({ ...form, broker: e.target.value })}
              placeholder="Fidelity"
            />
          </Field>
          {/* THE ACCOUNT'S OBJECTIVE. All optional, and all unset by default —
              a target nobody entered is exactly what Phase 4 removed. */}
          <Field label="Target value ($)">
            <Input
              type="number"
              value={form.target_value}
              placeholder="Not set"
              onChange={(e) => setForm({ ...form, target_value: e.target.value })}
            />
          </Field>
          <Field label="Target date">
            <Input
              type="date"
              value={form.target_date}
              onChange={(e) => setForm({ ...form, target_date: e.target.value })}
            />
          </Field>
          <Field label="Contribution ($)">
            <Input
              type="number"
              value={form.contribution_amount}
              placeholder="No plan"
              onChange={(e) => setForm({ ...form, contribution_amount: e.target.value })}
            />
          </Field>
          <Field label="Every (days)">
            <Input
              type="number"
              value={form.contribution_cadence_days}
              placeholder="No plan"
              onChange={(e) => setForm({ ...form, contribution_cadence_days: e.target.value })}
            />
          </Field>
          <Field label="Contributions anchored on">
            <Input
              type="date"
              value={form.contribution_anchor_date}
              onChange={(e) => setForm({ ...form, contribution_anchor_date: e.target.value })}
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

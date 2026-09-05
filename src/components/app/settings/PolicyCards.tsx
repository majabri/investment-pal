// The Settings policy editors (IPS-lite caps, the objective, the margin rate).
//
// They live here rather than in the route for the same reason SummaryPanels
// does: the route wires data, the components render it. Each card takes the
// loaded record and its loading flag as PROPS rather than calling the hook
// itself, which is what lets them be tested for the load-window behaviour
// without mocking the data layer or dragging the route tree into the tests
// program.
//
// The load guard is the point of this module. `useIpsLite` returns
// `query.data ?? IPS_LITE_DEFAULTS`, and TanStack leaves `data` undefined until
// the first fetch resolves, so during the load window the hook hands back the
// ADR-APP-004 defaults — 30%/25% caps, and a NULL margin rate via
// MARGIN_POLICY_UNSET. These editors used to populate from that through an
// effect with Save enabled, which made two money-adjacent writes reachable:
// saving in the window wrote the defaults over the stored caps, and the rate
// field showed blank even when a rate was stored — and blank is the value the
// rate form uses to CLEAR the rate (ADR-APP-007).
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { rateStatus } from "@/lib/marginCost";
import { isFutureLocalDate } from "@/lib/localDate";
import type { IpsLite } from "@/lib/ipsPolicy";

// Only the objective fields this card reads and writes, rather than the whole
// Goal row. Structural typing means the route can still pass its Goal straight
// in, and the components stay independent of the data layer — which is what
// lets the tests below run without the Supabase client in their program.
type Objective = {
  id: string;
  target_value: number;
  target_date: string;
  starting_value: number;
  monthly_contribution: number;
};

// Just the slice of a TanStack mutation these cards use, so the components do
// not depend on the hooks module beyond its types.
type MutateOpts = { onSuccess?: () => void; onError?: (e: unknown) => void };
type Saver<T> = { mutate: (patch: T, opts?: MutateOpts) => void; isPending: boolean };

// IPS-lite policy editor (ADR-APP-004). Position cap + margin cap govern the
// committee prompt and the Constitution Check strip. Money-adjacent numbers were
// signed off in ADR-APP-004; edits here re-set the policy going forward.
export function IpsLiteCard({
  ips,
  isLoading,
  save,
}: {
  ips: IpsLite;
  isLoading: boolean;
  save: Saver<Partial<IpsLite>>;
}) {
  // The form is mounted only once the stored policy has actually arrived.
  //
  // `useIpsLite` returns `query.data ?? IPS_LITE_DEFAULTS`, and `query.data` is
  // undefined until the first fetch resolves — so during the load window the
  // hook hands back the ADR-APP-004 defaults (30% / 25%). The form used to
  // populate from that via an effect, with no loading guard and Save enabled,
  // which meant a save in that window wrote the defaults over the stored
  // policy. Mounting the form from loaded data removes the window entirely,
  // and removes the effect-sync (react-hooks/set-state-in-effect) with it.
  return (
    <section className="mb-4 rounded-2xl border bg-card p-5">
      <div className="mb-1 text-sm font-medium">Investment policy (IPS-lite)</div>
      <p className="mb-3 text-xs text-muted-foreground">
        Governs the committee prompt and the Constitution Check strip. The objective never justifies
        overriding these limits or the evidence contract.
      </p>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading the stored policy…</p>
      ) : (
        <IpsLiteForm ips={ips} save={save} />
      )}
    </section>
  );
}

function IpsLiteForm({ ips, save }: { ips: IpsLite; save: Saver<Partial<IpsLite>> }) {
  // Initialised from the loaded policy, then owned by the form. It is not
  // re-synced from the server: doing so would discard whatever is half-typed,
  // and the values it would sync to are the ones the user is editing.
  const [posCap, setPosCap] = useState(String(ips.position_cap_pct));
  const [marginCap, setMarginCap] = useState(String(ips.margin_cap_pct));
  const [mode, setMode] = useState(ips.position_cap_hard ? "hard" : "soft");

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
    <div className="grid gap-3 sm:grid-cols-[200px_200px_160px_auto]">
      <div>
        <Label className="text-xs" htmlFor="ips-position-cap">
          Max single position (% of gross)
        </Label>
        <Input
          type="number"
          min={0}
          max={100}
          id="ips-position-cap"
          value={posCap}
          onChange={(e) => setPosCap(e.target.value)}
        />
      </div>
      <div>
        <Label className="text-xs" htmlFor="ips-margin-cap">
          Max margin utilization (% of acct)
        </Label>
        <Input
          type="number"
          min={0}
          max={100}
          id="ips-margin-cap"
          value={marginCap}
          onChange={(e) => setMarginCap(e.target.value)}
        />
      </div>
      <div>
        <Label className="text-xs">Position cap enforcement</Label>
        <Select value={mode} onValueChange={setMode}>
          <SelectTrigger aria-label="Position cap enforcement">
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
export function ObjectiveCard({
  goal,
  isLoading,
  update,
}: {
  goal: Objective | null | undefined;
  isLoading: boolean;
  update: Saver<Partial<Objective> & { id: string }>;
}) {
  return (
    <section className="mb-4 rounded-2xl border bg-card p-5">
      <div className="mb-1 text-sm font-medium">Objective</div>
      {isLoading ? (
        // Loading is NOT the same as absent. This card used to render "No
        // objective set yet" for the whole load window, telling the owner their
        // objective did not exist while it was still being fetched.
        <p className="text-xs text-muted-foreground">Loading the objective…</p>
      ) : !goal ? (
        // No goal row: say so rather than rendering a form whose save has nowhere
        // to go. Creating one from here would invent a target.
        <p className="text-xs text-muted-foreground">
          No objective set yet. Create one on the Goal screen — the dashboard, the goal screen and
          the committee prompt all read that single row.
        </p>
      ) : (
        <ObjectiveForm goal={goal} update={update} />
      )}
    </section>
  );
}

function ObjectiveForm({
  goal,
  update,
}: {
  goal: Objective;
  update: Saver<Partial<Objective> & { id: string }>;
}) {
  const [target, setTarget] = useState(String(goal.target_value ?? ""));
  const [date, setDate] = useState(goal.target_date ?? "");
  const [starting, setStarting] = useState(String(goal.starting_value ?? ""));
  const [monthly, setMonthly] = useState(String(goal.monthly_contribution ?? ""));

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
    <>
      <p className="mb-3 text-xs text-muted-foreground">
        One objective, read by the dashboard, the goal screen and the committee prompt. Editing it
        here and editing it on the Goal screen change the same row — there is no second copy.
      </p>
      <div className="grid gap-3 sm:grid-cols-[180px_180px_180px_180px_auto]">
        <div>
          <Label className="text-xs" htmlFor="objective-target">
            Target value ($)
          </Label>
          {/* `min` matches the check in onSave. A browser constraint that
              disagrees with the validation produces an error message the form
              itself said was fine. */}
          <Input
            type="number"
            min={0.01}
            step="0.01"
            id="objective-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs" htmlFor="objective-date">
            Target date
          </Label>
          <Input
            type="date"
            id="objective-date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs" htmlFor="objective-starting">
            Starting value ($)
          </Label>
          <Input
            type="number"
            min={0}
            id="objective-starting"
            value={starting}
            onChange={(e) => setStarting(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs" htmlFor="objective-monthly">
            Monthly contribution ($)
          </Label>
          <Input
            type="number"
            min={0}
            id="objective-monthly"
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
    </>
  );
}

// Margin rate (ADR-APP-007). The rate is IPS policy, not app config, and it is
// entered here rather than committed to source: Fidelity's rate is tiered by
// debit balance and floats with the base rate, so any value baked into code is
// wrong over time. Unset is a valid, shipped state — the app suppresses the
// cost figure rather than computing with a fallback.
export function MarginRateCard({
  ips,
  isLoading,
  save,
}: {
  ips: IpsLite;
  isLoading: boolean;
  save: Saver<Partial<IpsLite>>;
}) {
  // Same load guard as the policy card, and it matters more here. During the
  // load window `useIpsLite` hands back IPS_LITE_DEFAULTS, whose rate is null
  // (MARGIN_POLICY_UNSET) — so the field showed BLANK even when a rate was
  // stored, and blank is the value this form uses to CLEAR the rate. Saving in
  // that window un-set a rate that was correctly set, which is exactly the
  // "leverage looks free" failure ADR-APP-007 exists to prevent.
  return (
    <section className="mb-4 rounded-2xl border bg-card p-5">
      <div className="mb-1 text-sm font-medium">Margin rate</div>
      <p className="mb-3 text-xs text-muted-foreground">
        Your current Fidelity margin rate. Nothing in the app supplies a default: while this is
        blank, the dashboard shows no interest cost and the committee is told the rate is not set.
        Fidelity tiers by debit balance and floats with the base rate, so enter the tier that
        applies to your balance and re-check it periodically.
      </p>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading the stored rate…</p>
      ) : (
        <MarginRateForm ips={ips} save={save} />
      )}
    </section>
  );
}

function MarginRateForm({ ips, save }: { ips: IpsLite; save: Saver<Partial<IpsLite>> }) {
  const [rate, setRate] = useState(
    ips.margin_rate_annual_pct == null ? "" : String(ips.margin_rate_annual_pct),
  );
  const [asOf, setAsOf] = useState(ips.margin_rate_as_of ?? "");
  const [floating, setFloating] = useState(ips.margin_rate_is_floating ? "floating" : "fixed");
  const [staleDays, setStaleDays] = useState(String(ips.margin_rate_stale_days));

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
    <>
      {status.kind === "stale" ? (
        <p className="mb-3 text-xs font-medium text-amber-500">
          Verified {status.ageDays} days ago — older than your {ips.margin_rate_stale_days}-day
          threshold.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[160px_180px_160px_160px_auto]">
        <div>
          <Label className="text-xs" htmlFor="margin-rate">
            Annual rate (%)
          </Label>
          <Input
            type="number"
            min={0}
            max={100}
            step="0.001"
            placeholder="not set"
            id="margin-rate"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs" htmlFor="margin-rate-as-of">
            Verified on
          </Label>
          <Input
            type="date"
            id="margin-rate-as-of"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Rate type</Label>
          <Select value={floating} onValueChange={setFloating}>
            <SelectTrigger aria-label="Rate type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="floating">Floating</SelectItem>
              <SelectItem value="fixed">Fixed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs" htmlFor="margin-rate-stale-days">
            Flag as stale after (days)
          </Label>
          <Input
            type="number"
            min={1}
            id="margin-rate-stale-days"
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
    </>
  );
}

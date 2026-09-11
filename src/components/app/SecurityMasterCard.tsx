// Giving every held symbol a stable identity (UNIV-001 / DATA-001).
//
// `securities` and `security_aliases` shipped as tables with zero call sites —
// nothing read them, nothing wrote them, every `security_id` was NULL, and the
// ticker stayed the de facto identity. This is the surface that makes them
// real: one action that creates a security per held label and points the
// holdings at it.
//
// It does not rename anything. The symbol stays on the holding as a LABEL,
// which is the whole of DATA-001 — identity is added beside the label, not
// substituted for it, so nothing that reads `symbol` today changes behaviour.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Fingerprint } from "lucide-react";

import { Button } from "@/components/ui/button";
import { planBackfill } from "@/lib/securityMaster";
import type { BackfillPlan } from "@/lib/securityMaster";
import { useAllHoldings, useBackfillSecurities, useSecurityAliases } from "@/hooks/useAppData";

/** What the plan means, in the holder's terms. Null when there is nothing to say. */
export function backfillSummary(plan: BackfillPlan): string {
  const parts: string[] = [];
  if (plan.create.length > 0) {
    parts.push(`${plan.create.length} to identify`);
  }
  if (plan.alreadyResolved.length > 0) {
    parts.push(`${plan.alreadyResolved.length} already identified`);
  }
  if (plan.ambiguous.length > 0) {
    // Named separately and never folded into a total: an ambiguous label is
    // not progress, and counting it beside the others would hide that it needs
    // a person.
    parts.push(`${plan.ambiguous.length} ambiguous`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Nothing held to identify.";
}

export function SecurityMasterCard() {
  const { data: holdings = [] } = useAllHoldings();
  const { data: aliases = [], isPending } = useSecurityAliases();
  const backfill = useBackfillSecurities();
  const [done, setDone] = useState<BackfillPlan | null>(null);

  const symbols = useMemo(() => [...new Set(holdings.map((h) => h.symbol))], [holdings]);
  const plan = useMemo(() => planBackfill(symbols, aliases), [symbols, aliases]);

  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="mb-1 text-sm font-medium">Security identity</div>
      <p className="mb-3 text-xs text-muted-foreground">
        A ticker can be reused or renamed, so it is a label rather than an identity. This gives each
        holding a stable id that survives a rename, and keeps the ticker on the row as the label.
      </p>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <p className="text-sm">{backfillSummary(plan)}</p>
      )}

      {plan.ambiguous.length > 0 ? (
        <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          {plan.ambiguous.join(", ")} — more than one security claims{" "}
          {plan.ambiguous.length === 1 ? "this label" : "these labels"}. They are left untouched:
          picking one would make the ambiguity permanent.
        </p>
      ) : null}

      {done !== null ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Identified {done.create.length}. Their sector and asset class are unset — nothing was
          guessed from the ticker.
        </p>
      ) : null}

      <Button
        className="mt-4"
        size="sm"
        disabled={plan.create.length === 0 || backfill.isPending || isPending}
        aria-label="Give every held symbol a stable security identity"
        onClick={() =>
          backfill.mutate(
            { symbols, aliases },
            {
              onSuccess: (p) => {
                setDone(p);
                toast.success(
                  p.create.length === 0
                    ? "Everything was already identified."
                    : `Identified ${p.create.length} securit${p.create.length === 1 ? "y" : "ies"}.`,
                );
              },
              onError: (e) => toast.error((e as Error).message),
            },
          )
        }
      >
        <Fingerprint className="mr-1 h-4 w-4" />
        {backfill.isPending ? "Identifying…" : "Identify holdings"}
      </Button>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Safe to run again — labels that already resolve are left alone rather than re-created, which
        would split one holding's history across two identities.
      </p>
    </div>
  );
}

// Recording what crossed the account's boundary (PERF-001, write side).
//
// The arithmetic for cash-flow-aware return shipped in #190 and has never run
// on a real figure: `cash_flows` had exactly one call site and it was a SELECT.
// The table existed and was unreachable, so `flowCoverage` could only ever
// answer `unknown` and the performance panel could only ever say "these are
// changes in value, not returns".
//
// Two separate acts, deliberately two buttons:
//
//   Record    — one flow happened. Says nothing about the rest.
//   Reviewed  — the history is complete through today. This is the claim that
//               moves coverage off `unknown`, and it is the one the return
//               depends on, so it is never a side effect of the first.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, CheckCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/Field";
import {
  DEFAULT_TREATMENT,
  KIND_LABEL,
  emptyDraft,
  validateFlow,
} from "@/lib/cashFlows";
import type { CashFlowKind, CashFlowTreatment, FlowDraft, FlowCoverage } from "@/lib/cashFlows";
import { localIsoDate } from "@/lib/localDate";
import { useMarkFlowsReviewed, useRecordCashFlow } from "@/hooks/useAppData";

const KINDS: CashFlowKind[] = ["deposit", "withdrawal", "dividend", "fee", "interest"];

const TREATMENT_HELP: Record<CashFlowTreatment, string> = {
  external: "Crossed the boundary — removed from return.",
  internal: "Happened inside the account — counts as return.",
};

/** What the account's coverage means, said plainly rather than as a status word. */
export function coverageSentence(coverage: FlowCoverage, rowCount: number): string {
  if (coverage === "unknown") {
    return rowCount > 0
      ? `${rowCount} flow${rowCount === 1 ? "" : "s"} recorded, but the history has not been marked complete — returns stay unavailable until it is.`
      : "No flow history for this account, so returns cannot be separated from deposits and withdrawals.";
  }
  if (coverage === "none") {
    return "Marked complete with no flows. Returns are true time-weighted returns.";
  }
  return `Marked complete with ${rowCount} flow${rowCount === 1 ? "" : "s"}. Deposits and withdrawals are removed from returns.`;
}

export function CashFlowPanel({
  accountId,
  coverage,
  rowCount,
}: {
  /** NULL when no single account is in scope — flows are account-scoped. */
  accountId: string | null;
  coverage: FlowCoverage;
  rowCount: number;
}) {
  const today = localIsoDate();
  const [draft, setDraft] = useState<FlowDraft>(() => emptyDraft(today));
  const record = useRecordCashFlow();
  const review = useMarkFlowsReviewed();

  const problems = useMemo(() => validateFlow(draft), [draft]);
  const problemFor = (field: "flowDate" | "amount" | "symbol") =>
    problems.find((p) => p.field === field)?.message ?? null;
  // Shown only once the holder has typed something, so an untouched form is not
  // covered in red before they have done anything wrong.
  const touched = draft.amount !== null || draft.flowDate !== today;

  if (accountId === null) {
    return (
      <div className="rounded-2xl border bg-card p-5">
        <div className="mb-1 text-sm font-medium">Cash flows</div>
        <p className="text-sm text-muted-foreground">
          Select a single account to record its deposits and withdrawals. Flows belong to one
          account, not to the household.
        </p>
      </div>
    );
  }

  const submit = () => {
    if (problems.length > 0) return;
    record.mutate(
      { accountId, draft },
      {
        onSuccess: () => {
          setDraft(emptyDraft(today, draft.kind));
          // Says exactly what was and was not achieved. Recording a flow does
          // not make the history complete, and a toast implying otherwise is
          // how somebody comes to trust a return built on half a history.
          toast.success(
            coverage === "unknown"
              ? "Flow recorded. Mark the history complete to turn on returns."
              : "Flow recorded.",
          );
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="mb-1 text-sm font-medium">Cash flows</div>
      <p className="mb-3 text-xs text-muted-foreground">{coverageSentence(coverage, rowCount)}</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Date">
          <Input
            type="date"
            max={today}
            value={draft.flowDate}
            onChange={(e) => setDraft({ ...draft, flowDate: e.target.value })}
            aria-invalid={touched && problemFor("flowDate") !== null}
          />
        </Field>

        <Field label="What happened">
          <select
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={draft.kind}
            onChange={(e) => {
              const kind = e.target.value as CashFlowKind;
              // The treatment is RE-SUGGESTED on a kind change, never forced:
              // a dividend swept out to a bank account is external, and only
              // the holder knows that. The stored column stays authoritative.
              setDraft({ ...draft, kind, treatment: DEFAULT_TREATMENT[kind] });
            }}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Amount (negative for money out)">
          <Input
            type="number"
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            value={draft.amount ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, amount: e.target.value === "" ? null : +e.target.value })
            }
            aria-invalid={touched && problemFor("amount") !== null}
          />
        </Field>

        <Field label="Treatment">
          <select
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={draft.treatment}
            onChange={(e) =>
              setDraft({ ...draft, treatment: e.target.value as CashFlowTreatment })
            }
          >
            <option value="external">External — removed from return</option>
            <option value="internal">Internal — counts as return</option>
          </select>
        </Field>

        <Field label="Symbol (optional)">
          <Input
            placeholder="e.g. for a dividend"
            value={draft.symbol ?? ""}
            onChange={(e) => setDraft({ ...draft, symbol: e.target.value || null })}
            aria-invalid={touched && problemFor("symbol") !== null}
          />
        </Field>

        <Field label="Note (optional)">
          <Input
            placeholder="Why, in your words"
            value={draft.note ?? ""}
            onChange={(e) => setDraft({ ...draft, note: e.target.value || null })}
          />
        </Field>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        {TREATMENT_HELP[draft.treatment]}
      </p>

      {/* Every refusal says which box and what to do about it. A sign typed the
          wrong way round is the one mistake here that inverts a return
          silently, so it is named rather than reported as invalid input. */}
      {touched && problems.length > 0 ? (
        <ul className="mt-2 space-y-1 text-[11px] text-amber-600 dark:text-amber-400">
          {problems.map((p) => (
            <li key={`${p.field}-${p.message}`}>{p.message}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={submit}
          disabled={problems.length > 0 || record.isPending}
          aria-label="Record this cash flow"
        >
          <Plus className="mr-1 h-4 w-4" />
          {record.isPending ? "Recording…" : "Record flow"}
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={review.isPending}
          aria-label="Mark this account's flow history complete through today"
          onClick={() =>
            review.mutate(
              { accountId },
              {
                onSuccess: () =>
                  toast.success("History marked complete — returns are now cash-flow adjusted."),
                onError: (e) => toast.error((e as Error).message),
              },
            )
          }
        >
          <CheckCheck className="mr-1 h-4 w-4" />
          {review.isPending ? "Saving…" : "Mark history complete"}
        </Button>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Marking it complete says you have entered everything up to today. It is what turns the
        performance figures from value changes into returns, so it is a separate button from
        recording a flow.
      </p>
    </div>
  );
}

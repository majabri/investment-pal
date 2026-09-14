// Recording one fill against an order (§12.3, write side).
//
// The read side landed in #215. This is the form that makes "partial fill
// updates exactly once" (§26.2) something a holder can do rather than a test
// that passes: every refusal names its box, a duplicate broker reference is
// refused before the row is built, and fees left blank stay NOT KNOWN rather
// than becoming zero.
//
// What it says on success is exact. Recording a fill does not change the
// order's filled quantity — that stays the broker's word — and a toast that
// implied otherwise is how somebody comes to trust a roll-up nobody updated.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/Field";
import { useRecordFill } from "@/hooks/useAppData";
import { emptyFillDraft, localIsoMinute, validateFillDraft } from "@/lib/fillDraft";
import type { FillDraft, FillProblem } from "@/lib/fillDraft";
import type { Fill } from "@/lib/fills";
import type { Order } from "@/lib/orders";

export function FillForm({
  order,
  existing,
  onDone,
}: {
  order: Order;
  /** This order's fills — what a broker reference is checked against. */
  existing: readonly Fill[];
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<FillDraft>(() => emptyFillDraft());
  const record = useRecordFill();

  const problems = useMemo(() => validateFillDraft(draft, existing), [draft, existing]);
  const problemFor = (field: FillProblem["field"]) =>
    problems.find((p) => p.field === field)?.message ?? null;
  // Shown once the holder has typed a figure, so an untouched form is not
  // covered in red before they have done anything wrong.
  const touched = draft.quantity !== null || draft.price !== null;

  const submit = () => {
    if (problems.length > 0) return;
    record.mutate(
      { orderId: order.id, draft, existing },
      {
        onSuccess: () => {
          toast.success(
            "Fill recorded. The order's filled quantity is unchanged — the line beneath it says whether they agree.",
          );
          onDone();
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const num = (v: string): number | null => (v === "" ? null : +v);

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="mb-2 text-xs font-medium">
        Record a fill on {order.symbol}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="When it filled">
          <Input
            type="datetime-local"
            max={localIsoMinute()}
            value={draft.filledAt}
            onChange={(e) => setDraft({ ...draft, filledAt: e.target.value })}
            aria-invalid={touched && problemFor("filledAt") !== null}
          />
        </Field>
        <Field label="Quantity">
          <Input
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            placeholder="shares"
            value={draft.quantity ?? ""}
            onChange={(e) => setDraft({ ...draft, quantity: num(e.target.value) })}
            aria-invalid={touched && problemFor("quantity") !== null}
          />
        </Field>
        <Field label="Price">
          <Input
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            placeholder="per share"
            value={draft.price ?? ""}
            onChange={(e) => setDraft({ ...draft, price: num(e.target.value) })}
            aria-invalid={touched && problemFor("price") !== null}
          />
        </Field>
        <Field label="Fees (blank if not known)">
          <Input
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            placeholder="not known"
            value={draft.fees ?? ""}
            onChange={(e) => setDraft({ ...draft, fees: num(e.target.value) })}
            aria-invalid={touched && problemFor("fees") !== null}
          />
        </Field>
        <Field label="Broker reference (optional)">
          <Input
            placeholder="confirmation number"
            value={draft.brokerRef ?? ""}
            onChange={(e) => setDraft({ ...draft, brokerRef: e.target.value || null })}
            aria-invalid={touched && problemFor("brokerRef") !== null}
          />
        </Field>
        <Field label="Note (optional)">
          <Input
            placeholder="in your words"
            value={draft.note ?? ""}
            onChange={(e) => setDraft({ ...draft, note: e.target.value || null })}
          />
        </Field>
      </div>
      {/* Blank fees are "not known", and that is a different claim from zero.
          Said here because the placeholder alone reads as a hint, not a rule. */}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Leave fees blank if you do not know them. Zero means the trade was free. The side comes
        from the order, so the quantity is always positive.
      </p>
      {touched && problems.length > 0 ? (
        <ul className="mt-2 space-y-1 text-[11px] text-amber-600 dark:text-amber-400">
          {problems.map((p) => (
            <li key={`${p.field}-${p.message}`}>{p.message}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={submit}
          disabled={problems.length > 0 || record.isPending}
          aria-label={`Record this fill on ${order.symbol}`}
        >
          <Plus className="mr-1 h-4 w-4" />
          Record fill
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} aria-label="Cancel recording a fill">
          <X className="mr-1 h-4 w-4" />
          Cancel
        </Button>
      </div>
    </div>
  );
}

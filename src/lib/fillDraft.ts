// A fill as the holder types it, and the row it becomes (§12.3, §26.2).
//
// The shape `cashFlows.ts` set: a draft that can be half-typed, a validator
// that says which box and what to do about it, and an insert builder that
// hands the validator's guarantee to the compiler. `fills.ts` stays pure and
// untouched — `fillRejection` is the authority on what may be recorded, and
// the test in `fillDraft.test.ts` pins this validator to it so the two cannot
// drift: a draft passes here exactly when `fillRejection` returns null.
//
// What recording a fill does NOT do: change `orders.filled_quantity`. That
// stays what the broker or the import reported. The fills are the evidence;
// the roll-up is the claim; `reconcileFills` is where they meet. Writing Σ
// fills back onto the order would make the app the author of a figure it is
// supposed to be checking.

import type { Insert } from "@/lib/dbRows";
import { fillRejection } from "@/lib/fills";
import type { Fill, FillSource } from "@/lib/fills";

export type FillDraft = {
  /** A `datetime-local` value — `YYYY-MM-DDTHH:mm` in the holder's local time. */
  filledAt: string;
  /** NULL while the box is empty. Always positive once typed; the side is the order's. */
  quantity: number | null;
  price: number | null;
  /** NULL = not known. Zero is a claim that the trade was free. */
  fees: number | null;
  brokerRef: string | null;
  note: string | null;
};

/** Why a draft cannot be stored, in the holder's terms. */
export type FillProblem = {
  field: "filledAt" | "quantity" | "price" | "fees" | "brokerRef";
  message: string;
};

const LOCAL_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const pad = (n: number): string => String(n).padStart(2, "0");

/** Now, as a `datetime-local` value in local time. The form's default and its `max`. */
export function localIsoMinute(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * Whether a string is a real local minute in `YYYY-MM-DDTHH:mm` form.
 *
 * Round-tripped, for the reason `isRealCalendarDate` is: `new Date` rolls
 * 31 February forward to 3 March rather than refusing it.
 */
export function isRealLocalMinute(value: string): boolean {
  if (!LOCAL_MINUTE.test(value)) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return localIsoMinute(parsed) === value;
}

export function isFutureLocalMinute(value: string, now: Date = new Date()): boolean {
  return new Date(value).getTime() > now.getTime();
}

const trimOrNull = (s: string | null): string | null => {
  if (s === null) return null;
  const t = s.trim();
  return t === "" ? null : t;
};

/**
 * Every reason the draft cannot be stored, each naming its box.
 *
 * The rules are `fillRejection`'s, restated per field so the form can mark
 * more than the first one. `existing` is this order's fills — the same list
 * `fillRejection` checks a broker reference against.
 */
export function validateFillDraft(
  draft: FillDraft,
  existing: readonly Fill[],
  now: Date = new Date(),
): FillProblem[] {
  const out: FillProblem[] = [];

  if (!isRealLocalMinute(draft.filledAt)) {
    out.push({ field: "filledAt", message: "Enter when the fill happened, to the minute." });
  } else if (isFutureLocalMinute(draft.filledAt, now)) {
    out.push({
      field: "filledAt",
      message: "That time is in the future. Record a fill after it has happened.",
    });
  }

  const q = draft.quantity;
  if (q === null || !Number.isFinite(q)) {
    out.push({ field: "quantity", message: "Enter how many shares filled." });
  } else if (q <= 0) {
    out.push({
      field: "quantity",
      message: "A fill is always a positive quantity. Whether it bought or sold is the order's side.",
    });
  }

  const p = draft.price;
  if (p === null || !Number.isFinite(p)) {
    out.push({ field: "price", message: "Enter the price it filled at." });
  } else if (p <= 0) {
    out.push({
      field: "price",
      message: "Nothing fills at nothing. A zero price is a missing price — leave it and come back.",
    });
  }

  const f = draft.fees;
  if (f !== null && (!Number.isFinite(f) || f < 0)) {
    out.push({
      field: "fees",
      message: "Fees are a cost or nothing. A rebate is real, but it belongs in cash flows.",
    });
  }

  const ref = trimOrNull(draft.brokerRef);
  if (ref !== null) {
    // Case-insensitive, like the authority: brokers are not consistent about
    // it, and two rows differing only in case are one execution twice.
    const seen = existing.some((e) => e.broker_ref?.trim().toLowerCase() === ref.toLowerCase());
    if (seen) {
      out.push({
        field: "brokerRef",
        message:
          "That broker reference is already recorded against this order. A second row would double the fill.",
      });
    }
  }

  return out;
}

export function canRecordFill(
  draft: FillDraft,
  existing: readonly Fill[],
  now: Date = new Date(),
): boolean {
  return validateFillDraft(draft, existing, now).length === 0;
}

/**
 * The candidate `fillRejection` sees for this draft. Exported so the test can
 * pin the two validators together rather than trusting that they agree.
 */
export function candidateOf(draft: FillDraft): Parameters<typeof fillRejection>[0] {
  return {
    quantity: draft.quantity,
    price: draft.price,
    fees: draft.fees,
    broker_ref: trimOrNull(draft.brokerRef),
  };
}

/**
 * The row to insert. Reached only after `canRecordFill`, which is where the
 * `as number` casts get their warrant — the generated type requires numbers,
 * and that is the right requirement.
 *
 * `source` defaults to `user_entry` because that is what a typed form is. It
 * is typed as `FillSource` and no wider, so the one thing this can never say
 * is that a model recorded it (rule 18).
 */
export function fillInsert(input: {
  userId: string;
  orderId: string;
  draft: FillDraft;
  source?: FillSource;
}): Insert<"fills"> {
  const { draft } = input;
  return {
    user_id: input.userId,
    order_id: input.orderId,
    // A local minute becomes an instant here, once, at the boundary.
    filled_at: new Date(draft.filledAt).toISOString(),
    quantity: draft.quantity as number,
    price: draft.price as number,
    // NULL stays NULL. Not known is not free.
    fees: draft.fees,
    source: input.source ?? "user_entry",
    broker_ref: trimOrNull(draft.brokerRef),
    note: trimOrNull(draft.note),
  };
}

export function emptyFillDraft(now: Date = new Date()): FillDraft {
  return {
    filledAt: localIsoMinute(now),
    quantity: null,
    price: null,
    fees: null,
    brokerRef: null,
    note: null,
  };
}

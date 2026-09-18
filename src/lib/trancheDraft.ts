// A tranche as the holder opens it, and the row it becomes; and the one
// change a tranche ever takes afterwards — closing (§12.4, BR-010).
//
// The shape `fillDraft.ts` set: a draft that can be half-typed, a validator
// that names the box, and an insert builder that hands the validator's
// guarantee to the compiler. The rules restate `tranches_bounds` — the CHECK in
// the ledger migration — in the holder's terms, so a refusal arrives as a
// sentence about a field rather than as a Postgres error about a constraint.
// `trancheDraft.test.ts` reads the migration and pins each rule to its clause.
//
// What opening a tranche does NOT do: change a holding. The holding is what
// the broker reports; the tranche is the holder's account of which decision
// opened which part of it. `trancheCoverage` is where the two are compared,
// and a tranche that does not match the holding is shown as not matching —
// never used to correct it.
//
// What closing does NOT do: reduce anything. A closed tranche keeps its opened
// quantity; what remained at the close is a question for the fills against
// it, and a stored remainder would be a second source of truth (tranches.ts).

import type { Insert } from "@/lib/dbRows";
import { isFutureLocalMinute, isRealLocalMinute, localIsoMinute } from "@/lib/fillDraft";
import type { Tranche, TrancheKind } from "@/lib/tranches";
import { isTrancheKind } from "@/lib/trancheRows";

export type TrancheDraft = {
  symbol: string;
  /** NULL until chosen. There is no default kind: core and tactical are
   *  different lifecycles, and a form that pre-picked one would record it
   *  for everyone who did not notice the box. */
  kind: TrancheKind | null;
  /** A `datetime-local` value — `YYYY-MM-DDTHH:mm` in the holder's local time. */
  openedAt: string;
  /** NULL while the box is empty. Always positive once typed. */
  quantity: number | null;
  /** The price the plan aims at. NULL = no target stated, which is allowed. */
  target: number | null;
  invalidation: string | null;
  note: string | null;
  /**
   * The decision that opened it (§A.3, §12.2). NULL = none named. Optional
   * deliberately: a tranche recorded from a statement may predate any
   * decision the app holds, and forcing a link would invent one.
   */
  decisionId: string | null;
};

/** Why a draft cannot be stored, in the holder's terms. */
export type TrancheProblem = {
  field: "symbol" | "kind" | "openedAt" | "quantity" | "target";
  message: string;
};

const trimOrNull = (s: string | null): string | null => {
  if (s === null) return null;
  const t = s.trim();
  return t === "" ? null : t;
};

/** Symbols are stored as the label the holder reads: trimmed, upper-cased. */
export const normaliseSymbol = (s: string): string => s.trim().toUpperCase();

/**
 * Every reason the draft cannot be stored, each naming its box.
 *
 * Each rule is a clause of `tranches_bounds`, restated. There is no TypeScript
 * authority for these the way `fillRejection` is for fills, so the migration
 * is the authority and the test pins this function to it.
 */
export function validateTrancheDraft(draft: TrancheDraft, now: Date = new Date()): TrancheProblem[] {
  const out: TrancheProblem[] = [];

  if (normaliseSymbol(draft.symbol) === "") {
    out.push({ field: "symbol", message: "Enter the symbol this tranche is in." });
  }

  if (draft.kind === null || !isTrancheKind(draft.kind)) {
    out.push({
      field: "kind",
      message: "Say whether this is a core holding or a tactical trade. They close separately.",
    });
  }

  if (!isRealLocalMinute(draft.openedAt)) {
    out.push({ field: "openedAt", message: "Enter when the tranche was opened, to the minute." });
  } else if (isFutureLocalMinute(draft.openedAt, now)) {
    out.push({
      field: "openedAt",
      message: "That time is in the future. Record a tranche once it has been opened.",
    });
  }

  const q = draft.quantity;
  if (q === null || !Number.isFinite(q)) {
    out.push({ field: "quantity", message: "Enter how many shares this tranche opened with." });
  } else if (q <= 0) {
    out.push({
      field: "quantity",
      message: "A tranche opens with a positive quantity. A short position is a different record.",
    });
  }

  const t = draft.target;
  if (t !== null && (!Number.isFinite(t) || t <= 0)) {
    out.push({
      field: "target",
      message: "A target is a price, or nothing. Leave it blank if the plan has none.",
    });
  }

  return out;
}

export function canOpenTranche(draft: TrancheDraft, now: Date = new Date()): boolean {
  return validateTrancheDraft(draft, now).length === 0;
}

/**
 * The row to insert. Reached only after `canOpenTranche`, which is where the
 * casts get their warrant — the generated type requires a number and a
 * string, and those are the right requirements.
 */
export function trancheInsert(input: {
  userId: string;
  accountId: string;
  draft: TrancheDraft;
}): Insert<"tranches"> {
  const { draft } = input;
  return {
    user_id: input.userId,
    account_id: input.accountId,
    symbol: normaliseSymbol(draft.symbol),
    kind: draft.kind as TrancheKind,
    // A local minute becomes an instant here, once, at the boundary.
    opened_at: new Date(draft.openedAt).toISOString(),
    opened_quantity: draft.quantity as number,
    target: draft.target,
    invalidation: trimOrNull(draft.invalidation),
    note: trimOrNull(draft.note),
    // §A.3's chain from decision to tranche, as the holder named it. NULL
    // when they named none — never guessed from the symbol.
    decision_id: draft.decisionId,
    // The security master assigns this separately (DATA-001); a tranche must
    // not wait on it.
    security_id: null,
    closed_at: null,
  };
}

export function emptyTrancheDraft(symbol: string = "", now: Date = new Date()): TrancheDraft {
  return {
    symbol,
    kind: null,
    openedAt: localIsoMinute(now),
    quantity: null,
    target: null,
    invalidation: null,
    note: null,
    decisionId: null,
  };
}

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

/**
 * Why a tranche cannot be closed at `closedAt`, or null when it can.
 *
 * One sentence rather than a list: the close form has one box. The last rule
 * is the CHECK's — a tranche cannot close before it opened — and it is
 * compared as instants, because the opened time is stored as one.
 */
export function closeRejection(
  tranche: Pick<Tranche, "opened_at" | "closed_at">,
  closedAt: string,
  now: Date = new Date(),
): string | null {
  if (tranche.closed_at !== null) {
    return `This tranche was already closed on ${tranche.closed_at.slice(0, 10)}. A closed tranche is not reopened or re-closed.`;
  }
  if (!isRealLocalMinute(closedAt)) return "Enter when the tranche was closed, to the minute.";
  if (isFutureLocalMinute(closedAt, now)) {
    return "That time is in the future. Close a tranche once it has been closed.";
  }
  if (new Date(closedAt).getTime() < new Date(tranche.opened_at).getTime()) {
    return "A tranche cannot close before it opened. Check the time.";
  }
  return null;
}

export function canCloseTranche(
  tranche: Pick<Tranche, "opened_at" | "closed_at">,
  closedAt: string,
  now: Date = new Date(),
): boolean {
  return closeRejection(tranche, closedAt, now) === null;
}

/** The one column a close changes. Reached only after `canCloseTranche`. */
export function trancheClosePatch(closedAt: string): { closed_at: string } {
  return { closed_at: new Date(closedAt).toISOString() };
}

// Positions that aggregate for display and close separately (§12.4, BR-010).
//
// The blueprint's worked example, verbatim in shape: a 50-share core holding
// plus a new 10-share tactical trade displays as 60 aggregate shares, and the
// 10-share tranche stays separately identifiable for lifecycle, attribution and
// exit logic.
//
// This is NOT `position_lots`. A lot answers "what did these shares cost and
// how long have I held them" — tax questions. A tranche answers "which decision
// opened this, what was the plan, and when does it close" — lifecycle
// questions. The same shares belong to both, and conflating them is how
// exiting "the tactical piece" becomes a share count worked out by hand.

/** What kind of position a tranche is. The two the blueprint distinguishes. */
export type TrancheKind = "core" | "tactical";

export type Tranche = {
  id: string;
  account_id: string;
  symbol: string;
  /** Stable identity where the security master has it (DATA-001). */
  security_id: string | null;
  kind: TrancheKind;
  /** The decision that opened it, where one did. */
  decision_id: string | null;
  opened_at: string;
  /** NULL = still open. */
  closed_at: string | null;
  opened_quantity: number;
  target: number | null;
  invalidation: string | null;
};

/** Open on a given instant. Closing is a fact about a moment, not a flag. */
export const isOpen = (t: Pick<Tranche, "closed_at">): boolean => t.closed_at === null;

/**
 * What a symbol shows as, across every tranche in one account.
 *
 * The AGGREGATE is what the holdings table displays. The parts are what the
 * exit logic needs. Both, always — a screen that shows only the aggregate
 * cannot offer "close the tactical piece", and one that shows only the parts
 * disagrees with the broker.
 */
export type SymbolPosition = {
  symbol: string;
  /** Σ open quantity across kinds. NULL when any tranche is unusable. */
  aggregate: number | null;
  /** Open quantity by kind. A kind with no open tranche is absent, not zero. */
  byKind: Partial<Record<TrancheKind, number>>;
  /** Open tranches, newest first. */
  open: Tranche[];
};

const usable = (t: Tranche): boolean =>
  Number.isFinite(t.opened_quantity) && t.opened_quantity > 0;

/**
 * One symbol's position, split by kind.
 *
 * `openQuantityOf` is deliberately the tranche's OPENED quantity rather than a
 * remainder. What remains after partial exits is derived from fills against the
 * tranche, and storing a remainder would create a second source of truth that
 * drifts from them. A tranche is open or closed; partial exits reduce the
 * position through the fills, not by editing the tranche.
 */
export function symbolPosition(symbol: string, tranches: readonly Tranche[]): SymbolPosition {
  const mine = tranches.filter((t) => t.symbol === symbol);
  const open = mine
    .filter(isOpen)
    .slice()
    .sort((a, b) => (a.opened_at < b.opened_at ? 1 : a.opened_at > b.opened_at ? -1 : 0));

  const byKind: Partial<Record<TrancheKind, number>> = {};
  let aggregate = 0;
  let known = true;

  for (const t of open) {
    if (!usable(t)) {
      known = false;
      continue;
    }
    aggregate += t.opened_quantity;
    byKind[t.kind] = (byKind[t.kind] ?? 0) + t.opened_quantity;
  }

  return { symbol, aggregate: known ? aggregate : null, byKind, open };
}

/**
 * Whether the tranches account for the holding the broker reports.
 *
 * `not_recorded` — no tranches at all. The state every symbol is in until one
 *   is opened, and NOT a discrepancy: it means nobody has recorded lifecycle
 *   for this holding, which is different from recording it wrongly.
 * `matched`, `over`, `under` — as they read.
 * `unknown` — either side cannot be stated.
 *
 * Mirrors `lotCoverage`'s shape deliberately. Two coverage vocabularies for two
 * views of the same shares is how a screen ends up saying different things
 * about one position.
 */
export type TrancheCoverage = "not_recorded" | "matched" | "over" | "under" | "unknown";

/** Fractional shares are real; exact equality is the wrong test. */
export const TRANCHE_QUANTITY_EPSILON = 1e-4;

export function trancheCoverage(
  tranches: readonly Tranche[],
  holdingQuantity: number | null,
): TrancheCoverage {
  const open = tranches.filter(isOpen);
  if (open.length === 0) return "not_recorded";
  if (holdingQuantity === null || !Number.isFinite(holdingQuantity)) return "unknown";
  if (open.some((t) => !usable(t))) return "unknown";
  const total = open.reduce((s, t) => s + t.opened_quantity, 0);
  const diff = total - holdingQuantity;
  if (Math.abs(diff) <= TRANCHE_QUANTITY_EPSILON) return "matched";
  return diff > 0 ? "over" : "under";
}

/**
 * Which tranche an exit should take from, given a kind.
 *
 * Newest first within the kind. NOT FIFO, and deliberately not a tax-lot
 * selection: this answers "which tactical trade am I closing", where the newest
 * open one is what a person means by "the position I just put on". Tax-lot
 * choice is `lots.ts`'s question and the two must not be conflated — selling
 * the newest tranche may well realise an older lot.
 */
export function exitCandidates(tranches: readonly Tranche[], kind: TrancheKind): Tranche[] {
  return tranches
    .filter((t) => isOpen(t) && t.kind === kind)
    .slice()
    .sort((a, b) => (a.opened_at < b.opened_at ? 1 : a.opened_at > b.opened_at ? -1 : 0));
}

/**
 * The sentence a holdings row needs when one symbol holds more than one kind.
 *
 * Null when there is nothing to disambiguate — a single kind needs no
 * explanation, and a caption on every row is a caption nobody reads.
 */
export function aggregationNote(p: SymbolPosition): string | null {
  const kinds = Object.keys(p.byKind) as TrancheKind[];
  if (kinds.length < 2) return null;
  const parts = kinds
    .sort()
    .map((k) => `${p.byKind[k]} ${k}`)
    .join(" + ");
  return `${p.aggregate ?? "—"} shares shown — ${parts}. Each closes separately.`;
}

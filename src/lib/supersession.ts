// A recommendation replaced without losing the one it replaced (DEC-005).
//
// §5.2: "Superseded recommendations remain immutable and link to their
// replacement." §31 DEC-002: "Recommendations shall support supersession
// without deleting history."
//
// `decisions` had neither a link nor an account, so the only way to change a
// recommendation was to lose the old one — and the ledger that exists to be
// institutional memory forgot exactly the thing worth remembering: that the
// view changed, and when, and to what.
//
// The link points from the NEW decision to the one it replaces. That direction
// is the whole design: writing it the other way would mean UPDATING the
// superseded row, and a row that gets updated is not immutable.

/** The fields supersession reads. A decision has many more. */
export type DecisionLink = {
  id: string;
  decided_on: string;
  /** NULL = this decision replaces nothing. */
  supersedes_decision_id: string | null;
  /** NULL = nobody recorded which account (§13.1). Not "the default account". */
  account_id: string | null;
};

/**
 * Whether a decision is the current word, given everything known.
 *
 * Current means nothing supersedes it. A decision with no successor is current
 * whether or not it supersedes something itself — a chain's head is current,
 * and every link behind it is history.
 */
export function isCurrent(decision: DecisionLink, all: readonly DecisionLink[]): boolean {
  return !all.some((d) => d.supersedes_decision_id === decision.id);
}

/**
 * The chain ending at a decision, oldest first.
 *
 * Walks BACKWARDS through `supersedes_decision_id`, so the result reads as the
 * history that led here. A missing link stops the walk rather than throwing:
 * an ancestor the caller did not load is a gap in what was fetched, not a
 * corrupt ledger, and the partial chain is still true as far as it goes.
 *
 * Cycle-safe. The database forbids a self-link and the unique index forbids two
 * decisions superseding one, but neither prevents a longer cycle — and a walk
 * that loops forever on bad data is a worse failure than a short answer.
 */
export function supersessionChain(
  head: DecisionLink,
  all: readonly DecisionLink[],
): DecisionLink[] {
  const byId = new Map(all.map((d) => [d.id, d]));
  const chain: DecisionLink[] = [head];
  const seen = new Set<string>([head.id]);

  let cursor: DecisionLink | undefined = head;
  while (cursor?.supersedes_decision_id) {
    const prev: DecisionLink | undefined = byId.get(cursor.supersedes_decision_id);
    if (!prev || seen.has(prev.id)) break;
    seen.add(prev.id);
    chain.push(prev);
    cursor = prev;
  }

  return chain.reverse();
}

/**
 * Why a proposed supersession cannot be recorded, or null.
 *
 * The database enforces the first three; these are the readable refusals, and
 * the fourth is one SQL cannot express at all.
 */
export type SupersessionRejection =
  | "self"
  | "already_superseded"
  | "unknown_target"
  | "different_account"
  | "account_not_known"
  | "predates_target";

export function supersessionRejection(
  /** The decision being written. `id` is absent until it exists. */
  candidate: { id?: string; decided_on: string; account_id: string | null },
  targetId: string,
  all: readonly DecisionLink[],
): SupersessionRejection | null {
  if (candidate.id !== undefined && candidate.id === targetId) return "self";

  const target = all.find((d) => d.id === targetId);
  if (!target) return "unknown_target";

  if (all.some((d) => d.supersedes_decision_id === targetId && d.id !== candidate.id)) {
    return "already_superseded";
  }

  // A decision about one account cannot replace a decision about another. The
  // database cannot check this — both columns are nullable, and a NULL is an
  // absence rather than a mismatch — so it is checked here, where the
  // distinction can be made.
  //
  // Two NULLs are the interesting case, and they get their OWN reason rather
  // than being folded into `different_account`. Neither row says what it was
  // about, so nothing establishes they are about the same thing — but nothing
  // establishes they differ either, and reporting a mismatch would name a
  // conflict that was never observed. `account_not_known` is the honest answer
  // and it is also the actionable one: record the account, then supersede.
  //
  // The consequence is deliberate. Every decision written before this migration
  // has a NULL account, so none can be superseded until somebody says which
  // account it was about. Refusing is recoverable; a supersession chain built
  // across two accounts is not.
  if (candidate.account_id === null || target.account_id === null) {
    return candidate.account_id === target.account_id ? "account_not_known" : "different_account";
  }
  if (candidate.account_id !== target.account_id) return "different_account";

  // A replacement dated before what it replaces inverts the history. Same-day
  // is allowed — a view can change twice in one session, and `decided_on` is a
  // date rather than an instant.
  if (candidate.decided_on < target.decided_on) return "predates_target";

  return null;
}

/** Whether a proposed supersession may be recorded. */
export function canSupersede(
  candidate: Parameters<typeof supersessionRejection>[0],
  targetId: string,
  all: readonly DecisionLink[],
): boolean {
  return supersessionRejection(candidate, targetId, all) === null;
}

/**
 * The current decisions only, for a screen that should not show history twice.
 *
 * Superseded rows are not deleted and not hidden from the ledger — they are
 * excluded from the LIST OF WHAT STANDS. Reading the chain is how you see them,
 * which is the difference between history and clutter.
 */
export function currentDecisions(all: readonly DecisionLink[]): DecisionLink[] {
  const superseded = new Set(
    all.map((d) => d.supersedes_decision_id).filter((id): id is string => id !== null),
  );
  return all.filter((d) => !superseded.has(d.id));
}

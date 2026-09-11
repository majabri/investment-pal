// Whether today's balance snapshot should be written (§19.3, idempotency).
//
// This was four guards inside a `useEffect` with no test file, and one of them
// was an `eslint-disable` comment — a guard a later edit removes in good faith,
// because nothing says what it is for.
//
// It is a pure function here for the reason the rest of this codebase puts
// decisions in `lib/`: the interesting part is the refusals, and a refusal is
// only worth having if something proves it still happens. Testing it through
// the component meant mocking the account context, the query hooks and — by
// import — the Supabase client, which drags a browser client into the test
// typecheck to assert four booleans.
//
// The component keeps the effect, the subscription and the `record` dependency
// it must not have. It no longer keeps the decision.

/** Everything the decision needs. No React, no network, no clock. */
export type SnapshotGateInput = {
  /** NULL when the account's cash or margin loan is not known (Phase 1a). */
  gross: number | null;
  net: number | null;
  marginUsed: number | null;
  /** Snapshots are per account; the household has no single balance to record. */
  isAccountScope: boolean;
  /** The existing history is still arriving. */
  isLoading: boolean;
  /** A write is already in flight. */
  isPending: boolean;
  /** The most recent recorded day, or null when there is no history. */
  lastRecordedDate: string | null;
  /** The OWNER\'s calendar day, not UTC. */
  today: string;
};

/**
 * Why a snapshot is not being written, or null when it should be.
 *
 * A reason rather than a boolean: "already recorded today" and "the balance is
 * unknown" are different facts, and a caller that wanted to explain itself
 * could not reconstruct which from a `false`.
 */
export type SnapshotRefusal =
  | "not_an_account"
  | "unknown_balance"
  | "no_value_yet"
  | "history_loading"
  | "write_in_flight"
  | "already_recorded_today";

export function snapshotRefusal(input: SnapshotGateInput): SnapshotRefusal | null {
  if (!input.isAccountScope) return "not_an_account";
  // A snapshot is a permanent, append-only record. A row derived from an
  // unknown balance is a wrong day in the series that every later chart, day
  // change and reconciliation reads as fact.
  if (input.gross === null || input.net === null || input.marginUsed === null) {
    return "unknown_balance";
  }
  // A zero gross is the loading state, not an account worth nothing.
  if (!(input.gross > 0)) return "no_value_yet";
  // Writing before the existing rows arrive cannot know whether today is
  // already recorded, so it would duplicate on every cold load.
  if (input.isLoading) return "history_loading";
  if (input.isPending) return "write_in_flight";
  // By the OWNER\'s day. Comparing UTC dates recorded a second row for what the
  // user would call the same day, every evening west of Greenwich.
  if (input.lastRecordedDate === input.today) return "already_recorded_today";
  return null;
}

/**
 * The decision, carrying the figures when it is yes.
 *
 * A boolean would leave the caller re-checking the three nulls the gate has
 * just checked, so the two could drift — and the compiler would not know the
 * figures were proven, which is how a redundant check becomes load-bearing.
 */
export type SnapshotDecision =
  | { record: false; reason: SnapshotRefusal }
  | { record: true; figures: { gross: number; net: number; marginUsed: number } };

/** Whether to write. The database\'s unique index is still the guarantee. */
export function snapshotDecision(input: SnapshotGateInput): SnapshotDecision {
  const reason = snapshotRefusal(input);
  if (reason !== null) return { record: false, reason };
  return {
    record: true,
    // Non-null by construction: `snapshotRefusal` returns `unknown_balance`
    // for any of the three, so reaching here proves all three.
    figures: {
      gross: input.gross as number,
      net: input.net as number,
      marginUsed: input.marginUsed as number,
    },
  };
}

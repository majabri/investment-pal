// How an account's rows become a `ReconciliationInput`.
//
// Extracted in Phase 5 because the readiness gate (rule 17) reconciles the same
// account the reconciliation panel does, and two copies of this mapping would
// eventually disagree about WHAT the app is comparing — while both rendered a
// confident status. Rule 9's "one engine" applies to the inputs as much as to
// the arithmetic.
//
// Pure, so the mapping is testable without React or the Supabase client.
import type { ReconciliationInput } from "./reconciliation";
import type { SourceType } from "./freshness";

/** Structural minimum — the provenance columns Phase 1d added. */
export type ProvenancedAccount = {
  balances_source_type: string | null;
  balances_as_of: string | null;
};

export function reconciliationInputFor({
  latestValue,
  latestAsOf,
  account,
  calculatedValue,
  now = new Date(),
}: {
  /** The broker's own figure, from the most recent imported snapshot. */
  latestValue: number | null;
  latestAsOf: string | null;
  account: ProvenancedAccount | null;
  /** The app's figure, from the one accounting engine. */
  calculatedValue: number | null;
  now?: Date;
}): ReconciliationInput {
  return {
    external: {
      value: latestValue,
      provenance: { sourceType: "imported_snapshot", asOf: latestAsOf },
    },
    calculated: {
      value: calculatedValue,
      // The balance's provenance, because the app's total is only as current
      // as the cash and margin figures underneath it (Phase 1d).
      positions: {
        sourceType: (account?.balances_source_type ?? null) as SourceType | null,
        asOf: account?.balances_as_of ?? null,
      },
      // Quotes refresh on their own cadence; the holdings are re-priced live
      // where a quote exists, so this is the moment they were fetched.
      quotes: { sourceType: "live_quote", asOf: now.toISOString() },
    },
  };
}

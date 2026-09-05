// The broker adapter contract (Phase 2, rules 3 and 28).
//
// Every broker prints its balances differently, names its fields differently,
// and signs its debits differently. All of that is INTERPRETATION, and it
// belongs in one place per broker — otherwise the interpretation spreads into
// the screens, and adding a second broker means editing portfolio logic.
//
// The contract is `parse → validate → map → canonical record`, and it is
// deliberately exposed as ONE method rather than three.
//
// That is the whole design decision. A three-method interface reads better and
// invites `map(parse(raw))`, which is a caller skipping validation — and the
// validation is the only thing standing between a mis-parse and a plausible
// wrong total. Making the steps individually callable would make skipping them
// individually possible, so `read()` runs all three or none.
import type { CanonicalBalance } from "../canonicalBalances";

/**
 * Something the adapter noticed while reading. NOT an error — the read still
 * returns a canonical record — but a reason to distrust it.
 *
 * Findings are returned rather than thrown for the same reason the parser
 * reports missing fields rather than failing: a partial or suspect read is a
 * RESULT the user should see, not an exception that discards what was read.
 */
export type AdapterFinding = {
  kind:
    /** The broker's own printed identity did not hold. The strongest signal
     *  available that a field is being read as something it is not. */
    | "identity_failed"
    /** A figure is present but outside any sane range for its kind. */
    | "out_of_range"
    /** A field was recognised but its meaning is not established, so it was
     *  carried and excluded from every calculation. */
    | "unsupported_field";
  message: string;
};

export type AdapterResult = {
  canonical: CanonicalBalance;
  /** Field keys the adapter recognised in the input, in its own vocabulary.
   *  For the import screen; nothing downstream may branch on these. */
  recognised: string[];
  findings: AdapterFinding[];
};

/**
 * One broker's interpretation, and the only place it may live.
 *
 * Adding a broker means adding a file that satisfies this type. It must not
 * mean touching anything that computes a portfolio — which is the property
 * `adapterContract.test.ts` proves with a synthetic second broker rather than
 * asserting in a comment.
 */
export type BrokerAdapter = {
  /** Stable machine id, stored as provenance (`balances_source`). */
  id: string;
  /** For people. */
  displayName: string;
  /**
   * Whether this adapter recognises the input as its own format.
   *
   * Deliberately conservative: a `false` means "someone else should try", and
   * an adapter claiming text it cannot actually read is worse than no adapter,
   * because it produces a confidently empty record instead of an unhandled one.
   */
  canRead(raw: string): boolean;
  /**
   * Parse, validate and map, in one step so none can be skipped.
   *
   * `asOf` is when the figures were TRUE, not when they were read (Phase 1d).
   * Callers that know better than "now" — a statement date on the page, say —
   * pass it; the default is the honest fallback for a live paste.
   */
  read(raw: string, asOf?: Date): AdapterResult;
};

// The canonical balance model, and what each broker field is allowed to mean
// (Phase 2, rules 3, 7, 8, 28).
//
// THE DEFECT THIS REPLACES
//
// `accountTotals.ts` carries the comment "Verified against a Fidelity balances
// page" over the formula `cash + positions − debit`. One real sample happened
// to reconcile. That is curve-fitting, not semantics: the formula may well be
// right, but nothing establishes it as right, and nothing would notice if a
// field were being read as something it is not.
//
// WHAT COULD AND COULD NOT BE ESTABLISHED
//
// The brief asks for each field's meaning from the broker's own definitions
// rather than from one sample's arithmetic. That was attempted and could not be
// done here: outbound access to fidelity.com and to the mirrored help content is
// blocked by this environment's egress policy, so no primary definition could be
// read. Rather than write down remembered definitions and present them as the
// broker's, each field below carries the BASIS on which its meaning rests, and
// anything without a basis is UNSUPPORTED and excluded from equity — which is
// what the brief says to do when a meaning cannot be established.
//
// The one basis available without the broker's documentation is better than a
// remembered definition anyway: an IDENTITY THE BROKER ITSELF PRINTS. If
// `total account value = cash market value + margin market value − net debit`
// holds on every import, the three components are being read as the broker reads
// them. If it stops holding, the mapping is wrong and the app can say so — which
// is the difference between a formula verified once and a formula checked every
// time.

/** How confident the app is about what a broker field means. */
export type SemanticBasis =
  /**
   * Checked against an identity the broker prints, on every import. The
   * strongest claim available without the broker's own documentation, and
   * stronger than a definition read once and never re-tested.
   */
  | "checked_identity"
  /**
   * The meaning is not in question — the field is a labelled scalar the broker
   * reports about itself (a rate, an accrued figure) and the app only stores and
   * displays it.
   */
  | "reported_scalar"
  /**
   * Meaning NOT established. Stored and displayed as the broker's own words,
   * never used in a calculation and never summed into equity.
   */
  | "unsupported";

/**
 * Whether a field may enter the equity calculation.
 *
 * Rule 8, stated as data rather than as a convention: buying power is not an
 * asset, securities market value is not equity, and margin market value is not
 * margin debt. Each of those is a mistake that produces a plausible number, so
 * the exclusion has to be checkable rather than remembered.
 */
export type EquityRole =
  /** Adds to gross assets. */
  | "asset"
  /** Subtracts — money owed. */
  | "liability"
  /** The broker's own answer, for reconciliation. Never a component. */
  | "broker_reported_equity"
  /**
   * Shown, never summed. Buying power, open-order commitments, surpluses: real
   * figures about capacity or constraint, not about what the account is worth.
   */
  | "informational";

export type FieldSemantics = {
  basis: SemanticBasis;
  role: EquityRole;
  /** Why it has that basis. Read by people; the reason is the point. */
  note: string;
};

/**
 * The canonical account balance, in the app's own vocabulary.
 *
 * Rule 7's concepts, and deliberately NOT one number per broker field. Two
 * things this shape enforces that four loose columns could not:
 *
 *   * `brokerReportedEquity` and `appCalculatedEquity` are separate fields.
 *     They are different claims by different parties, and collapsing them is
 *     what made reconciliation impossible — you cannot compare two numbers you
 *     have already averaged.
 *   * `informational` is a separate bag from the components. Nothing summing
 *     equity can reach a buying-power figure by accident, because they are not
 *     in the same place.
 *
 * Every money field is `number | null`: NULL means the broker did not supply it
 * (Phase 1a, rule 13).
 */
export type CanonicalBalance = {
  /** What the broker says the account is worth. Their claim, not ours. */
  brokerReportedEquity: number | null;
  /** What the app computes from components. Ours, and never adjusted to match
   *  theirs — a persistent difference is a finding, not a bug to tune away. */
  appCalculatedEquity: number | null;

  /** Market value of securities. NOT equity: it ignores the debit. */
  securitiesMarketValue: number | null;
  /** Cash, by variant. Settled and withdrawable are constraints on the same
   *  money, not additional money, so they are never summed together. */
  cash: {
    total: number | null;
    settled: number | null;
    withdrawable: number | null;
  };
  /** Money owed. Held as a POSITIVE magnitude and subtracted, so no consumer
   *  can get the direction wrong — a sign error on a debit is silent and the
   *  size of the whole loan. */
  marginDebt: number | null;
  accruedInterest: number | null;

  /**
   * Capacity and constraint figures. Displayed separately and NEVER summed into
   * equity (rule 8): buying power is what you could borrow against, which is
   * not money you have.
   */
  informational: {
    marginBuyingPower: number | null;
    nonMarginBuyingPower: number | null;
    committedToOpenOrders: number | null;
    /** Surpluses over a requirement. Their exact basis is broker-specific and
     *  is not established here, so they are carried and shown, never used. */
    houseSurplus: number | null;
    exchangeSurplus: number | null;
  };

  /** ISO 4217. No default — rule 32: USD-only is fine, USD-assumed is not. */
  currency: string | null;
  /** When these figures were TRUE (Phase 1d), not when they were fetched. */
  asOf: string | null;
};

/** An empty canonical balance: everything unknown, nothing assumed. */
export function emptyCanonicalBalance(): CanonicalBalance {
  return {
    brokerReportedEquity: null,
    appCalculatedEquity: null,
    securitiesMarketValue: null,
    cash: { total: null, settled: null, withdrawable: null },
    marginDebt: null,
    accruedInterest: null,
    informational: {
      marginBuyingPower: null,
      nonMarginBuyingPower: null,
      committedToOpenOrders: null,
      houseSurplus: null,
      exchangeSurplus: null,
    },
    currency: null,
    asOf: null,
  };
}

/**
 * The identity the broker prints about itself.
 *
 * `total account value = cash market value + margin market value − net debit`
 *
 * This is what makes the mapping checkable rather than asserted. It is not a
 * definition of the fields; it is a relationship between them that the broker's
 * own page satisfies, so if the app reads any of the three as something else,
 * the identity stops holding and the app has a finding rather than a wrong
 * number.
 *
 * Returns null when any component is missing — an identity cannot be checked
 * against figures that are not there, and "checked and passed" would be a
 * stronger claim than "we could not check".
 */
export type IdentityCheck =
  | { kind: "holds"; difference: number }
  | { kind: "differs"; difference: number; reported: number; computed: number }
  | { kind: "not-checkable"; missing: string[] };

export function checkEquityIdentity(
  reportedTotal: number | null,
  cashMarketValue: number | null,
  marginMarketValue: number | null,
  netDebit: number | null,
  /** Absolute dollars. Rounding noise must not raise a finding; a material
   *  difference must (rule 11). Not a function of portfolio size (rule 31). */
  toleranceUsd = 0.01,
): IdentityCheck {
  const missing: string[] = [];
  if (reportedTotal === null) missing.push("total account value");
  if (cashMarketValue === null) missing.push("cash market value");
  if (marginMarketValue === null) missing.push("margin market value");
  if (netDebit === null) missing.push("net debit");
  if (missing.length > 0) return { kind: "not-checkable", missing };

  const computed = (cashMarketValue as number) + (marginMarketValue as number) - (netDebit as number);
  const difference = (reportedTotal as number) - computed;
  return Math.abs(difference) <= toleranceUsd
    ? { kind: "holds", difference }
    : { kind: "differs", difference, reported: reportedTotal as number, computed };
}

/**
 * What each field the Fidelity parser extracts is allowed to mean, and why.
 *
 * Keyed by `BalanceFieldKey` so the two cannot drift apart silently — a parsed
 * field with no entry here has no established meaning, and the test suite says
 * so rather than letting it default into a calculation.
 */
export const FIDELITY_FIELD_SEMANTICS: Record<string, FieldSemantics> = {
  totalAccountValue: {
    basis: "checked_identity",
    role: "broker_reported_equity",
    note: "The broker's own answer for what the account is worth. Used to CHECK the app's arithmetic, never as a component of it — a figure that is both an input and the thing being verified verifies nothing.",
  },
  cashMarketValue: {
    basis: "checked_identity",
    role: "asset",
    note: "Enters equity as an asset. Its meaning rests on the printed identity total = cash + margin − debit holding on every import, not on one sample that reconciled.",
  },
  marginMarketValue: {
    basis: "checked_identity",
    role: "asset",
    note: "Securities market value. Enters equity as an ASSET, and is emphatically not margin debt (rule 8) — reading it as the loan would report a leveraged account as owing what it owns.",
  },
  netDebit: {
    basis: "checked_identity",
    role: "liability",
    note: "The margin loan, normalised to a POSITIVE magnitude on the way in and subtracted. The broker prints it as a debit; normalising once is why no consumer can get the direction wrong.",
  },

  equityPct: {
    basis: "reported_scalar",
    role: "informational",
    note: "The broker's own equity percentage. Displayed, and available as a second check on the identity, but never a component: a ratio cannot be summed into a total.",
  },
  dayChange: {
    basis: "reported_scalar",
    role: "informational",
    note: "Change since the previous close. A delta, not a balance.",
  },
  marginInterestAccruedMtd: {
    basis: "reported_scalar",
    role: "informational",
    note: "What the broker has actually charged this month. An observed fact and preferred over the app's own estimate, but a cost already reflected in the balances rather than a separate liability to subtract again.",
  },
  marginInterestRatePct: {
    basis: "reported_scalar",
    role: "informational",
    note: "The annual rate as a percentage. A rate, not money.",
  },

  marginBuyingPower: {
    basis: "reported_scalar",
    role: "informational",
    note: "BUYING POWER IS NOT AN ASSET (rule 8). It is what could be borrowed against the account, so summing it into equity would count the same securities twice and then some.",
  },
  nonMarginBuyingPower: {
    basis: "reported_scalar",
    role: "informational",
    note: "Cash available to trade without borrowing. A constraint on cash already counted, not additional cash.",
  },
  committedToOpenOrders: {
    basis: "reported_scalar",
    role: "informational",
    note: "Cash spoken for by unfilled orders. Reduces what is spendable without reducing what is owned, so it belongs beside equity rather than inside it.",
  },

  netHouseSurplus: {
    basis: "unsupported",
    role: "informational",
    note: "MEANING NOT ESTABLISHED. It is a surplus over some maintenance requirement, but which requirement, and whether the broker's house figure is net of pending activity, could not be established from a primary source in this environment. Stored and shown as the broker's own words; excluded from every calculation until someone can say what it is.",
  },
};

/** Fields that may enter the app's equity arithmetic, and how. */
export function equityRoleOf(field: string): EquityRole | null {
  return FIDELITY_FIELD_SEMANTICS[field]?.role ?? null;
}

/**
 * Whether a field may be used in a calculation at all.
 *
 * An unsupported field is not merely excluded from equity — it is excluded from
 * arithmetic entirely. A meaning nobody can state is not a safe input to
 * anything, and "informational" is where it goes so it is still visible.
 */
export function isCalculable(field: string): boolean {
  const s = FIDELITY_FIELD_SEMANTICS[field];
  if (!s) return false;
  return s.basis !== "unsupported" && (s.role === "asset" || s.role === "liability");
}

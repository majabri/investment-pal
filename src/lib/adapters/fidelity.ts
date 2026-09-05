// The Fidelity adapter: the only place Fidelity's vocabulary is interpreted.
//
// The parsing itself lives in `lib/balanceImport.ts` and stays there — it is
// well-tested and this is a mapping layer, not a rewrite. What this file adds
// is the half that was missing: the mapping from Fidelity's field names to the
// canonical model is now WRITTEN DOWN and CHECKED, rather than being implied by
// which columns `accountPatch` happened to touch.
import {
  FIDELITY_FIELD_SEMANTICS,
  checkEquityIdentity,
  emptyCanonicalBalance,
  isCalculable,
  type CanonicalBalance,
} from "../canonicalBalances";
import { parseBalanceBlock, type BalanceFields } from "../balanceImport";
import { fmtUSD } from "../finance";
import type { AdapterFinding, AdapterResult, BrokerAdapter } from "./contract";

/**
 * Fidelity's fields, mapped to canonical concepts.
 *
 * Every line here is a claim about meaning, and each is either backed by the
 * printed identity (the three components) or is a figure carried without being
 * calculated with. Nothing lands in `appCalculatedEquity` — that is the app's
 * own arithmetic over positions and is not the adapter's to supply.
 */
function toCanonical(f: BalanceFields, asOf: Date): CanonicalBalance {
  const b = emptyCanonicalBalance();

  // The broker's claim, kept apart from ours so the two can be compared.
  b.brokerReportedEquity = f.totalAccountValue;

  // The three the identity backs.
  b.cash.total = f.cashMarketValue;
  b.securitiesMarketValue = f.marginMarketValue;
  b.marginDebt = f.netDebit;

  b.accruedInterest = f.marginInterestAccruedMtd;

  // Capacity and constraint. Never summed into equity (rule 8) — and they are
  // in a different object precisely so that cannot happen by accident.
  b.informational.marginBuyingPower = f.marginBuyingPower;
  b.informational.nonMarginBuyingPower = f.nonMarginBuyingPower;
  b.informational.committedToOpenOrders = f.committedToOpenOrders;
  // Carried, shown, never used: its basis is unsupported.
  b.informational.houseSurplus = f.netHouseSurplus;

  // Not parsed by this adapter. Left null rather than derived from something
  // adjacent — an exchange surplus inferred from a house surplus would be
  // exactly the label-inference rule 8 forbids.
  b.informational.exchangeSurplus = null;

  // Fidelity balances are USD. Stated by the adapter, which is the layer that
  // knows, rather than assumed by everything downstream (rule 32).
  b.currency = "USD";
  b.asOf = asOf.toISOString();
  return b;
}

/** Findings worth surfacing, in the order a reader should care about them. */
function validate(f: BalanceFields): AdapterFinding[] {
  const findings: AdapterFinding[] = [];

  const identity = checkEquityIdentity(
    f.totalAccountValue,
    f.cashMarketValue,
    f.marginMarketValue,
    f.netDebit,
  );
  if (identity.kind === "differs") {
    findings.push({
      kind: "identity_failed",
      message:
        `The broker's own total is ${fmtUSD(identity.reported)}, but cash + securities − debt ` +
        `comes to ${fmtUSD(identity.computed)} — a difference of ` +
        `${fmtUSD(Math.abs(identity.difference))}. Either a field is being read as something it ` +
        `is not, or the figures are from two different moments.`,
    });
  }

  // A debit stored negative means the sign normalisation failed upstream, and a
  // sign error on a loan is silent and the size of the whole loan.
  if (f.netDebit !== null && f.netDebit < 0) {
    findings.push({
      kind: "out_of_range",
      message: `The margin debt parsed as ${fmtUSD(f.netDebit)}. It is stored as a positive magnitude, so a negative here means the sign was normalised the wrong way.`,
    });
  }

  // Say so rather than dropping it silently: a figure that was present in the
  // paste and is not being used is worth one line.
  for (const [key, value] of Object.entries(f)) {
    if (value === null) continue;
    const semantics = FIDELITY_FIELD_SEMANTICS[key];
    if (semantics?.basis === "unsupported") {
      findings.push({
        kind: "unsupported_field",
        message: `"${key}" was in the paste and is recorded, but its meaning is not established, so it is excluded from every calculation.`,
      });
    }
  }

  return findings;
}

export const fidelityAdapter: BrokerAdapter = {
  id: "fidelity",
  displayName: "Fidelity",

  canRead(raw: string): boolean {
    // Conservative on purpose: claiming text this cannot actually read is worse
    // than declining it, because it yields a confidently empty record instead of
    // an unhandled one. Two recognised labels is the bar.
    const parsed = parseBalanceBlock(raw);
    const present = Object.values(parsed.fields).filter((v) => v !== null).length;
    return present >= 2;
  },

  read(raw: string, asOf: Date = new Date()): AdapterResult {
    const parsed = parseBalanceBlock(raw);
    const recognised = Object.entries(parsed.fields)
      .filter(([, v]) => v !== null)
      .map(([k]) => k);
    return {
      canonical: toCanonical(parsed.fields, asOf),
      recognised,
      findings: validate(parsed.fields),
    };
  },
};

/** The fields this adapter is willing to calculate with, for the guard test. */
export const FIDELITY_CALCULABLE = Object.keys(FIDELITY_FIELD_SEMANTICS).filter(isCalculable);

// The Constitution Check, as arithmetic rather than as 60 lines inside a JSX
// IIFE (audit brief G4).
//
// This is the app's governance surface: it decides whether to tell the holder
// that they have breached their own risk policy. It lived inline in
// `routes/_authenticated/index.tsx` inside a 150-line immediately-invoked
// function, mixed with the markup it produced, and had NO TESTS — which for a
// check that accuses somebody of breaking their own commitment is the wrong way
// round. Extracting it does not change a single comparison; it makes them
// assertable.
//
// Every rule here is deliberately not the app's opinion:
//
//   * the position and margin caps are the USER'S policy (ADR-APP-004), and
//     carry a qualifier while they are still app defaults (rule 15);
//   * the 50% equity floor is Reg-T, which the user cannot move, and carries
//     no such qualifier because it is not theirs (rule 21);
//   * an unknown account value means UNCHECKED, never clean.
import { denominators, labelledPct, marginUtilisationOf, weightOf } from "./concentration";
import { MARGIN_CAP_DENOMINATOR, POLICY_DENOMINATOR } from "./concentration";
import { fmtPct } from "./finance";
import { policyIsConfirmed } from "./policy";
import type { PolicySource } from "./policy";
import type { AccountTotals } from "./accountTotals";

/** A position, in the shape the check needs. Priced by the caller. */
export type CheckedPosition = {
  symbol: string;
  quantity: number;
  price: number;
};

/** The IPS-lite limits, in the shape the check needs. */
export type CheckedPolicy = {
  position_cap_pct: number;
  position_cap_hard: boolean;
  margin_cap_pct: number;
  caps_source: PolicySource | null;
};

/**
 * The verdict.
 *
 * `checkable` is separate from `breaches.length === 0` on purpose, and is the
 * whole reason this is a struct rather than a string array. A check that could
 * not run produces no breaches, and rendering that as "within policy" is a
 * governance check passing because it checked nothing — worse than one that
 * fails.
 */
export type ConstitutionVerdict = {
  breaches: string[];
  /** False when the account value or the margin debit is unknown. */
  checkable: boolean;
  /** True when the caps are the app's defaults rather than the user's choice. */
  capsAreDefaults: boolean;
};

/**
 * Which limits the holder is outside, in the words the strip shows.
 *
 * Every breach line names the denominator its percentage was computed against
 * (P0-05): a bare "NVDA 34.2% > 30% cap" is unfalsifiable without reading the
 * source, because the app has three denominators and ADR-APP-004 states the cap
 * against a fourth reading.
 */
export function constitutionCheck(
  positions: readonly CheckedPosition[],
  totals: AccountTotals,
  policy: CheckedPolicy,
): ConstitutionVerdict {
  const net = totals.totalAccountValue;
  const marginUsed = totals.marginDebit;
  // NOT `?? 1`. Assuming full equity when it is unknown makes the "equity below
  // 50%" breach unfireable on exactly the accounts whose data is missing.
  const equityPct = totals.equityPct;
  const checkable = net !== null && marginUsed !== null;

  const capsConfirmed = policyIsConfirmed(policy.caps_source);
  const capNote = capsConfirmed ? "" : " (default, not your setting)";
  const posCap = policy.position_cap_pct / 100;
  const denoms = denominators(totals);

  const breaches: string[] = [];
  for (const p of positions) {
    const value = p.quantity * p.price;
    const w = weightOf(value, denoms, POLICY_DENOMINATOR);
    if (w !== null && w > posCap) {
      breaches.push(
        `${p.symbol} ${labelledPct(w, POLICY_DENOMINATOR)} > ${policy.position_cap_pct}% cap${
          policy.position_cap_hard ? " (HARD)" : ""
        }${capNote}`,
      );
    }
  }

  // Margin utilisation has its own denominator rather than inheriting the
  // position cap's.
  const marginUtil = marginUtilisationOf(marginUsed, denoms, MARGIN_CAP_DENOMINATOR);
  if (marginUsed !== null && marginUsed > 0 && marginUtil !== null) {
    if (marginUtil > policy.margin_cap_pct / 100) {
      breaches.push(
        `Margin util ${labelledPct(marginUtil, MARGIN_CAP_DENOMINATOR)} > ${
          policy.margin_cap_pct
        }% cap${capNote}`,
      );
    }
  }

  // Reg-T, not a preference. No "(default, not your setting)" note, because it
  // is neither the app's default nor the user's choice (rule 21).
  if (marginUsed !== null && marginUsed > 0 && equityPct !== null && equityPct < 0.5) {
    breaches.push(`Equity ${fmtPct(equityPct)} < 50% (regulatory minimum)`);
  }

  return { breaches, checkable, capsAreDefaults: !capsConfirmed };
}

/**
 * How many whole days since the newest position was imported.
 *
 * `null` when nothing has ever been imported — which the strip renders as
 * "never imported", not as "imported today". A zero here would mean the
 * positions are fresh, and the difference is the whole point of the line.
 */
export function positionsStaleDays(
  positions: readonly { updated_at?: string | null }[],
  now: number = Date.now(),
): number | null {
  let latest: string | null = null;
  for (const p of positions) {
    const u = p.updated_at ?? null;
    if (u && (!latest || u > latest)) latest = u;
  }
  if (latest === null) return null;
  const ms = now - new Date(latest).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 86_400_000);
}

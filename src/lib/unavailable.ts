// Rendering a figure the app does not have (rule 30 of the user-agnostic
// financial truth standard, Phase 1a).
//
// Two absences that look identical on screen and are not the same fact:
//
//   * "—" already means NO SCOPE — no account is selected, so there is nothing
//     to compute. The user resolves it by choosing an account.
//   * UNAVAILABLE means an account IS selected and the figure is genuinely not
//     known: never imported, or the source did not supply it. The user resolves
//     it by importing a balance.
//
// Both used to render as `$0.00`, which is neither: it asserts a balance.
//
// A word rather than a symbol on purpose. A dash is read as "nothing here" and
// slides past; "Unavailable" is read as a claim about knowledge, which is what
// it is, and it survives being read aloud or pasted into a message.
import { fmtPct, fmtUSD } from "./finance";

export const UNAVAILABLE = "Unavailable";

/** A dollar figure, or a statement that it is not known. */
export function usdOrUnavailable(v: number | null | undefined, decimals?: number): string {
  return v === null || v === undefined || !Number.isFinite(v)
    ? UNAVAILABLE
    : fmtUSD(v, decimals);
}

/** A percentage, or a statement that it is not known. */
export function pctOrUnavailable(v: number | null | undefined, decimals?: number): string {
  return v === null || v === undefined || !Number.isFinite(v)
    ? UNAVAILABLE
    : fmtPct(v, decimals);
}

/**
 * What a number box means, when the figure it edits may be unknown.
 *
 * Empty is UNKNOWN, not 0: clearing the box says "I do not know this", and
 * writing 0 would say "this account has no cash" on the user's behalf.
 *
 * A partially-typed value is also unknown. `<input type="number">` permits "-",
 * "." and "1e" mid-entry, each of which parses to NaN — and NaN written to a
 * NUMERIC column is neither a figure nor an honest absence (Copilot, #140).
 */
export function numberOrUnknown(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

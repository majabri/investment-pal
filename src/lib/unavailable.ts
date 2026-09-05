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

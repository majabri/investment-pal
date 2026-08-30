// Account categorization for household grouping. Fidelity account names from
// the export map into stable categories for display.
//
// PR-UI-2: the primary category was previously decided by an exact match on one
// hardcoded account name, which made the whole app specific to a single
// portfolio and broke silently when that account was renamed. Categories are
// now derived from account *shape* (kids / 529 / crypto / retirement), and
// anything that is none of those is the holder's own primary account.
export type AccountCategory = "Primary" | "Kids" | "529" | "Crypto" | "IRA";

export const CATEGORY_ORDER: AccountCategory[] = ["Primary", "Kids", "529", "Crypto", "IRA"];

const KID_NAMES = ["Karim", "Zain", "Jude"];

export function accountCategory(name: string): AccountCategory {
  const n = name.trim();
  if (KID_NAMES.includes(n)) return "Kids";
  if (/529/.test(n)) return "529";
  if (/crypto/i.test(n)) return "Crypto";
  if (/\bIRA\b|ROTH|ROLLOVER/i.test(n)) return "IRA";
  return "Primary";
}

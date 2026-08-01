// Account categorization for household grouping. Fidelity account names
// from the export map into stable categories for display.
export type AccountCategory = "Amir" | "Kids" | "529" | "Crypto" | "IRA" | "Other";

export const CATEGORY_ORDER: AccountCategory[] = ["Amir", "Kids", "529", "Crypto", "IRA", "Other"];

export function accountCategory(name: string): AccountCategory {
  const n = name.trim();
  if (n === "Amir - TOD") return "Amir";
  if (["Karim", "Zain", "Jude"].includes(n)) return "Kids";
  if (/529/.test(n)) return "529";
  if (/crypto/i.test(n)) return "Crypto";
  if (/\bIRA\b|ROTH|ROLLOVER/i.test(n)) return "IRA";
  return "Other";
}

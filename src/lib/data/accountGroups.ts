// Account categorisation for household grouping.
//
// This used to decide what an account IS by string-matching its NAME: a list of
// the owner's children's first names meant "kids", /529/ meant an education
// account, /crypto/i meant crypto, /IRA|ROTH|ROLLOVER/i meant retirement, and
// `return "Primary"` swept up everything else.
//
// Four defects in one function (Phase 1b, rule 4):
//
//   * Renaming an account silently changed its tax treatment and which screens
//     and prompts included it.
//   * One household's first names were compiled into the classifier, so the app
//     could not serve a second user without a source change (rule 37).
//   * "Everything else is Primary" meant an unclassifiable account was not
//     unknown, it was confidently wrong.
//   * Nothing recorded WHY, so a misclassification was indistinguishable from a
//     decision.
//
// Categories now come from `accounts.account_type`, which the 1b migration
// populated once and the Settings editor lets a person confirm or correct.
// **Nothing here reads a name.**
import { ACCOUNT_TYPES, type AccountType } from "../accountMetadata";

export type AccountCategory = "Primary" | "Kids" | "529" | "Crypto" | "IRA" | "Unclassified";

export const CATEGORY_ORDER: AccountCategory[] = [
  "Primary",
  "Kids",
  "529",
  "Crypto",
  "IRA",
  // Last, and deliberately present. The old classifier had no such category —
  // an account it could not place became "Primary", so a misfiled account was
  // silently blended into the holder's own money.
  "Unclassified",
];

/**
 * Which category a type belongs to.
 *
 * Total over the type vocabulary rather than a lookup with a fallback: adding a
 * value to `ACCOUNT_TYPES` without deciding where it belongs is exactly how
 * "everything else is Primary" happened, and a `switch` with no default makes
 * the compiler ask.
 */
function categoryOfType(type: AccountType): AccountCategory {
  switch (type) {
    case "custodial":
      return "Kids";
    case "529":
      return "529";
    case "crypto":
      return "Crypto";
    case "ira":
    case "roth_ira":
    case "401k":
      return "IRA";
    // The holder's own money. HSA and trust sit here because no screen
    // distinguishes them yet — not because they are the same thing, and the
    // switch is where that gets revisited when one does.
    case "brokerage":
    case "cash":
    case "hsa":
    case "trust":
    case "other":
      return "Primary";
  }
}

/** Structural minimum — avoids depending on the full account row type. */
export type CategorisableAccount = { account_type: string | null };

/**
 * The category an account belongs to, or `Unclassified` when its type is not
 * known.
 *
 * An unknown type does NOT fall back to Primary. That fallback is what let one
 * user's account names define the app's behaviour, and it is also what made a
 * misfiled account indistinguishable from the holder's own: silently blended
 * into their totals rather than surfaced as a question.
 */
export function accountCategory(account: CategorisableAccount): AccountCategory {
  const t = account.account_type;
  if (t === null) return "Unclassified";
  // A type outside the vocabulary can only arrive from a database row written
  // before a value was retired, or by a hand edit. Unknown, not Primary.
  const known = KNOWN_TYPES.has(t) ? (t as AccountType) : null;
  return known === null ? "Unclassified" : categoryOfType(known);
}

// Derived, never restated. A second copy of the vocabulary is a second thing to
// forget to update, and the failure would be silent: an account of a real type
// quietly reported as Unclassified.
const KNOWN_TYPES: ReadonlySet<string> = new Set<string>(ACCOUNT_TYPES);

// The view model behind `/kids` and `/kids-prompt-center` (Phase 4, rule 22).
//
// Both screens built this shape inline and identically, and both fell back to
// `KIDS_SEED` — three named children with account-number-shaped strings and
// hand-copied share counts, compiled into the application. That fallback was
// two problems at once: mock data in application code, and an assumed
// dependant. It is gone. When there are no custodial accounts, these screens
// show an empty state; nothing here invents one.
//
// Pure: no React, no Supabase client, so the rules are unit-testable.
import { accountCategory } from "./data/accountGroups";
import { ageOf, memberOfAccount, type MemberLike } from "./household";
import { accountObjectiveOf, type AccountObjective } from "./accountObjective";

export type KidHolding = { symbol: string; shares: number; price: number; avgCost: number };

export type KidAccount = {
  id: string;
  /** The ACCOUNT's own name. Presentation only — nothing derives from it. */
  name: string;
  /** The linked member's name, or `null` when no member is linked. */
  holder: string | null;
  /** Whole years, or `null` when there is no member or no birth date. */
  age: number | null;
  /** NULL = not known. Never 0 for an account that has never been imported. */
  cash: number | null;
  /**
   * The account's own target and horizon, or `unset` with the missing fields
   * named. Never `FAMILY_POLICY`'s $200,000 by 2036 — that was one household's
   * objective rendered as every user's progress bar (rule 20).
   */
  objective: AccountObjective;
  holdings: KidHolding[];
};

export type KidAccountRow = {
  id: string;
  name: string;
  account_type: string | null;
  cash: number | null;
  owner_member_id: string | null;
  target_value: number | null;
  target_date: string | null;
  contribution_amount?: number | null;
  contribution_cadence_days?: number | null;
  contribution_anchor_date?: string | null;
};

export type KidHoldingRow = {
  account_id: string | null;
  symbol: string;
  quantity: number;
  cost_basis: number;
  current_price: number;
};

/**
 * Custodial accounts, by TYPE, with their holdings and their holder.
 *
 * Selection is `accountCategory(...) === "Kids"`, which reads
 * `accounts.account_type`. It used to match the account's NAME against a
 * hardcoded list of first names, so renaming an account removed a child from
 * the screen and no second household could ever appear on it (Phase 1b,
 * rule 4).
 *
 * An empty array means there are no custodial accounts — which for a new user
 * is the truth, not a loading state.
 */
export function kidAccounts(
  accounts: KidAccountRow[],
  holdings: KidHoldingRow[],
  members: MemberLike[],
  at = new Date(),
): KidAccount[] {
  return accounts
    .filter((a) => accountCategory(a) === "Kids")
    .map((a) => {
      const member = memberOfAccount(a, members);
      return {
        id: a.id,
        name: a.name,
        holder: member?.display_name ?? null,
        age: member ? ageOf(member.birth_date, at) : null,
        cash: a.cash === null || a.cash === undefined ? null : Number(a.cash),
        objective: accountObjectiveOf(a),
        holdings: holdings
          .filter((h) => h.account_id === a.id)
          .map((h) => ({
            symbol: h.symbol,
            shares: Number(h.quantity),
            price: Number(h.current_price),
            avgCost: Number(h.cost_basis),
          })),
      };
    });
}

/**
 * How to write an account's holder in a sentence, for a prompt: `Alex 12`,
 * `Alex` when the birth date is unknown, and the account's own name when no
 * member is linked at all.
 *
 * The last case is why this returns the account name rather than skipping the
 * account: a prompt that silently omits an account is a worse lie than one
 * that names it without an age.
 */
export function holderLabel(kid: KidAccount): string {
  if (kid.holder === null) return kid.name;
  return kid.age === null ? kid.holder : `${kid.holder} ${kid.age}`;
}

// Household membership — who an account belongs to (Phase 4, rule 22).
//
// This replaces a compiled-in array of three children, with names and birth
// dates, in `src/lib/data/familyPolicy.ts`. Two separate defects in one
// constant:
//
//   * It was personal data about minors in application source, in a public
//     repository. No personal data in `src/` is a permanent rule, not a
//     cleanup task.
//   * It was an ASSUMED DEPENDANT. Rule 22 makes household optional: a second
//     user of this app inherited three children, and no screen could tell that
//     it had made them up.
//
// Membership now lives in `public.household_members`, provisioned with NO ROWS.
// Family surfaces show an empty state until somebody adds a member, which is
// rule 22 stated as behaviour: the app must not know about anybody's children
// until it is told.
//
// Deliberately free of React and of the Supabase client so the rules below are
// unit-testable on their own; the hook in `useAppData` is the wiring.
import { isRealCalendarDate } from "./localDate";

/**
 * How a member relates to the account holder.
 *
 * Deliberately not "child": what the app actually cares about is whether a
 * longer horizon and a custodial arrangement apply, and "dependant" says that
 * without assuming a family shape (rule 22).
 */
export const RELATIONSHIPS = ["self", "dependant", "partner", "other"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export type HouseholdMember = {
  id: string;
  user_id: string;
  display_name: string;
  /** NULL = not known. Never a placeholder date — see `ageOf`. */
  birth_date: string | null;
  /** NULL = not stated. */
  relationship: string | null;
  created_at: string;
  updated_at: string;
};

/** Structural minimum, so callers need not depend on the full row types. */
export type MemberLike = { id: string; display_name: string; birth_date: string | null };
export type OwnedAccountLike = { owner_member_id: string | null };

/**
 * Age in whole years, or `null` when it cannot be known.
 *
 * Returns null rather than a number for a missing, malformed or impossible
 * birth date, and for a date in the future. The version this replaces returned
 * a `number` unconditionally, so a bad date produced `NaN` and a future one
 * produced a negative age — both of which rendered as if they were an age
 * (rule 13: unknown is not zero, and it is not NaN either).
 */
export function ageOf(birthDateIso: string | null | undefined, at = new Date()): number | null {
  if (!birthDateIso || !isRealCalendarDate(birthDateIso)) return null;
  const b = new Date(`${birthDateIso}T12:00:00`);
  let age = at.getFullYear() - b.getFullYear();
  const beforeBirthday =
    at.getMonth() < b.getMonth() || (at.getMonth() === b.getMonth() && at.getDate() < b.getDate());
  if (beforeBirthday) age -= 1;
  return age < 0 ? null : age;
}

/**
 * The member who holds an account, or `null`.
 *
 * Only the recorded link counts. There is no fallback to matching the
 * account's NAME against a member's name: that is the same defect Phase 1b
 * removed from account classification, and it would put one household's first
 * names back into the behaviour of the app by the back door.
 */
export function memberOfAccount<M extends MemberLike>(
  account: OwnedAccountLike,
  members: M[],
): M | null {
  const id = account.owner_member_id;
  if (id === null) return null;
  return members.find((m) => m.id === id) ?? null;
}

/**
 * How to write a member in a sentence: `Alex 12`, or just `Alex` when the
 * birth date is not known.
 *
 * The name alone is the honest rendering of an unknown age. Reaching a model
 * as `Alex 0` — which is what an age of `Number(undefined) || 0` produced —
 * is a fact about a person that nobody entered.
 */
export function describeMember(member: MemberLike, at = new Date()): string {
  const age = ageOf(member.birth_date, at);
  return age === null ? member.display_name : `${member.display_name} ${age}`;
}

/**
 * The distinct members holding the given accounts, in the order the accounts
 * appear, skipping accounts with no member recorded.
 *
 * An empty result is the normal state for a new user and for an existing one
 * who has not linked their accounts yet. Callers must render that as "not
 * stated" rather than inventing a roster.
 */
export function membersOfAccounts<M extends MemberLike>(
  accounts: OwnedAccountLike[],
  members: M[],
): M[] {
  const seen = new Set<string>();
  const out: M[] = [];
  for (const a of accounts) {
    const m = memberOfAccount(a, members);
    if (m && !seen.has(m.id)) {
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

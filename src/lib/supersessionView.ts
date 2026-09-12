// What a decision card says about having been replaced, or having replaced.
//
// `supersession.ts` answers the structural questions — is this current, what is
// the chain, may this replace that. This answers the presentation one, and it
// lives here rather than in the component because a component test would have
// to mount the page to assert on a sentence.
//
// The governing rule (DEC-005, §5.2): superseded decisions are NOT deleted and
// NOT hidden. They are marked. A ledger that exists to be institutional memory
// must still show the view that was held, which means the screen has to say
// "this was replaced" rather than quietly dropping the row.

import { isCurrent, supersessionChain } from "@/lib/supersession";
import type { DecisionLink } from "@/lib/supersession";

export type SupersessionStatus =
  /** Replaces nothing and nothing replaces it. The ordinary case — no badge. */
  | { state: "only" }
  /** Not the current word. Carries what replaced it, so the card can link on. */
  | { state: "superseded"; replacedBy: string }
  /** The current head of a chain. `revision` is 1-based within `of`. */
  | { state: "revision"; revision: number; of: number };

/**
 * How a decision stands, given everything loaded.
 *
 * `all` is the loaded window rather than the whole table, and that is sound in
 * one direction only: a replacement is never dated before its target
 * (`predates_target` refuses it), so in a newest-first window a target's
 * replacement is always at or above it. The exception is a same-day pair split
 * by the window's boundary — then the older half shows as current until the
 * window widens. Same-day supersession is deliberately allowed, so this is a
 * real if narrow gap, and it errs toward showing a decision as standing rather
 * than toward hiding one.
 */
export function supersessionStatus(
  decision: DecisionLink,
  all: readonly DecisionLink[],
): SupersessionStatus {
  if (!isCurrent(decision, all)) {
    const replacedBy = all.find((d) => d.supersedes_decision_id === decision.id);
    // `isCurrent` is false precisely because such a row exists, so this is
    // total — but a non-null assertion here would be a claim the type system
    // cannot check, and "only" is the honest fallback if it ever is not.
    if (replacedBy) return { state: "superseded", replacedBy: replacedBy.id };
    return { state: "only" };
  }

  const chain = supersessionChain(decision, all);
  if (chain.length <= 1) return { state: "only" };
  return { state: "revision", revision: chain.length, of: chain.length };
}

/**
 * The sentence a card shows, or null when there is nothing to say.
 *
 * Null for `only` on purpose: a badge on every decision is a badge nobody
 * reads, the same reasoning as `aggregationNote` and `unreadableNote`.
 */
export function supersessionLabel(status: SupersessionStatus): string | null {
  switch (status.state) {
    case "only":
      return null;
    case "superseded":
      // Says it still counts as history. "Superseded" alone reads to some as
      // "withdrawn", and the whole point of DEC-005 is that it was not.
      return "Superseded by a later decision. Kept as the view that was held at the time.";
    case "revision":
      return `Revision ${status.revision} of ${status.of} — replaces an earlier decision, which is kept.`;
  }
}

/** Whether a card should be visually de-emphasised. Only the replaced ones. */
export function isHistorical(status: SupersessionStatus): boolean {
  return status.state === "superseded";
}

// How the tranches panel says things (§12.4, BR-010). Presentation only; the
// arithmetic is `tranches.ts` and the boundary is `trancheRows.ts`.
//
// Pure: no React, no Supabase client.

import type { Tranche, TrancheCoverage, TrancheKind } from "@/lib/tranches";
import { isOpen, trancheCoverage } from "@/lib/tranches";

export const KIND_LABEL: Record<TrancheKind, string> = {
  core: "Core",
  tactical: "Tactical",
};

/** Open first, newest opened first within each; closed after, newest closed first. */
export function sortTranches<T extends Pick<Tranche, "opened_at" | "closed_at">>(
  tranches: readonly T[],
): T[] {
  return tranches.slice().sort((a, b) => {
    const oa = isOpen(a) ? 0 : 1;
    const ob = isOpen(b) ? 0 : 1;
    if (oa !== ob) return oa - ob;
    const ka = a.closed_at ?? a.opened_at;
    const kb = b.closed_at ?? b.opened_at;
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });
}

/**
 * What one holding's coverage means, or null when there is nothing to say.
 *
 * Null for `matched` — the ordinary state, and a line per matched symbol is a
 * list nobody reads. `not_recorded` IS said: it is the state every holding is
 * in until a tranche is opened, and the panel exists to change it.
 */
export function coverageSentence(
  symbol: string,
  coverage: TrancheCoverage,
  recorded: number | null,
  held: number | null,
): string | null {
  const q = (n: number | null): string =>
    n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  switch (coverage) {
    case "matched":
      return null;
    case "not_recorded":
      return `${symbol}: no tranche recorded. Which decision opened this holding, and when it closes, is not tracked.`;
    case "over":
      return `${symbol}: open tranches total ${q(recorded)} shares; the holding is ${q(held)}. More is recorded than held — a tranche was closed at the broker and not here, or opened twice.`;
    case "under":
      return `${symbol}: open tranches total ${q(recorded)} shares; the holding is ${q(held)}. Part of this holding has no tranche.`;
    case "unknown":
      return `${symbol}: whether the tranches match the holding cannot be stated.`;
  }
}

/**
 * The coverage line for every holding in an account, matched ones omitted.
 * Sorted by symbol so the list is stable between renders.
 */
export function coverageLines(
  holdings: readonly { symbol: string; quantity: number | null }[],
  tranches: readonly Tranche[],
): string[] {
  const out: string[] = [];
  for (const h of holdings.slice().sort((a, b) => a.symbol.localeCompare(b.symbol))) {
    const mine = tranches.filter((t) => t.symbol === h.symbol);
    const coverage = trancheCoverage(mine, h.quantity);
    const recorded = mine.filter(isOpen).reduce((s, t) => s + t.opened_quantity, 0);
    const line = coverageSentence(h.symbol, coverage, mine.some(isOpen) ? recorded : null, h.quantity);
    if (line !== null) out.push(line);
  }
  return out;
}

/**
 * The panel's one-line summary. Counts, never a judgement: how many tranches
 * are open, and how many of the account's holdings have any.
 */
export function trancheSummary(
  holdings: readonly { symbol: string }[],
  tranches: readonly Tranche[],
): string {
  const open = tranches.filter(isOpen);
  const covered = new Set(open.map((t) => t.symbol));
  const withTranche = holdings.filter((h) => covered.has(h.symbol)).length;
  if (tranches.length === 0) {
    return "No tranches recorded. Every holding here is a single undifferentiated position until one is opened.";
  }
  const n = open.length;
  return `${n} open tranche${n === 1 ? "" : "s"} across ${withTranche} of ${holdings.length} holding${holdings.length === 1 ? "" : "s"}; ${tranches.length - n} closed.`;
}

export function fmtQuantity(q: number | null): string {
  return q === null ? "—" : q.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/**
 * A decision as the tranche form offers it (§A.3). Structural: the picker
 * needs these six columns and nothing about where they came from.
 */
export type DecisionOption = {
  id: string;
  decided_on: string;
  symbol: string | null;
  action: string | null;
  recommendation: string;
  /** The holder's disposition: pending, followed, … */
  decision: string;
};

const MAX_LABEL = 96;

/** One line per option: date · ACTION SYMBOL · disposition — the recommendation, cut to fit. */
export function decisionOptionLabel(d: DecisionOption): string {
  const head = [d.decided_on.slice(0, 10), [d.action, d.symbol].filter(Boolean).join(" ") || null, d.decision]
    .filter((x): x is string => x !== null && x !== "")
    .join(" · ");
  const rec = d.recommendation.trim().replace(/\s+/g, " ");
  const room = Math.max(MAX_LABEL - head.length - 3, 12);
  const tail = rec.length > room ? `${rec.slice(0, room - 1)}…` : rec;
  return tail ? `${head} — ${tail}` : head;
}

/**
 * The options in the order the picker shows them: the draft's symbol first,
 * newest first within each group. Nothing is filtered out — a tranche in one
 * symbol can be opened under a decision written about the portfolio.
 */
export function rankDecisionOptions(options: readonly DecisionOption[], symbol: string): DecisionOption[] {
  const s = symbol.trim().toUpperCase();
  return options.slice().sort((a, b) => {
    const ma = s !== "" && (a.symbol ?? "").toUpperCase() === s ? 0 : 1;
    const mb = s !== "" && (b.symbol ?? "").toUpperCase() === s ? 0 : 1;
    if (ma !== mb) return ma - mb;
    return a.decided_on < b.decided_on ? 1 : a.decided_on > b.decided_on ? -1 : 0;
  });
}

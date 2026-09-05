// What an import may and may not do (Phase 6, rule 29).
//
// "Account-scoped, validated, previewed, atomic, auditable, idempotent where
// appropriate. An import to one account must not touch another. A failed
// import must not leave half-written financial data. Theses, notes, decisions
// and history must survive a position refresh."
//
// The atomicity and the preservation live in the `import_account_positions`
// function, because only the database can promise them. This module is the
// part that has to be right BEFORE the call: what cash figure to pass, which
// accounts are in scope, and what the user is shown before they commit.
//
// Pure: no React, no Supabase client.

/**
 * Columns on `holdings` that are the USER'S, not the broker's.
 *
 * The import must never write these, and the refresh must never drop them.
 * They are listed here rather than only in the SQL so a test can assert the
 * function's SET list excludes every one — two places that must agree, in two
 * languages, which is how this kind of rule rots.
 */
export const NARRATIVE_COLUMNS = [
  "original_thesis",
  "current_thesis",
  "why_own",
  "notes",
  "sector",
  "last_ai_review",
  "last_reviewed_at",
] as const;

/** Columns the import legitimately overwrites — the broker's own figures. */
export const IMPORTED_COLUMNS = [
  "quantity",
  "cost_basis",
  "current_price",
  "last_price_at",
] as const;

/**
 * The cash figure for one destination account, or `null` when the import
 * carried none.
 *
 * `null`, never 0. The caller this replaces wrote
 * `labels.reduce((c, l) => c + (cashByAccount[l] ?? 0), 0)`, and the parser
 * only creates a key when the CSV actually carried a cash line — so an account
 * whose export had none was written to as holding exactly $0.00. That is the
 * Phase 1a defect, in the path that writes money most often.
 *
 * A destination fed by several source labels needs ALL of them to carry cash
 * before their sum means anything: two known figures plus one missing is not
 * the account's cash, it is a number short by whatever the third was.
 */
export function cashForAccount(
  sourceLabels: readonly string[],
  cashByAccount: Readonly<Record<string, number>>,
): number | null {
  if (sourceLabels.length === 0) return null;
  let total = 0;
  for (const label of sourceLabels) {
    const v = cashByAccount[label];
    if (v === undefined || v === null || !Number.isFinite(v)) return null;
    total += v;
  }
  return total;
}

export type ImportRow = {
  symbol: string;
  quantity: number;
  cost_basis: number;
  current_price: number;
};

export type ImportPreview = {
  accountId: string;
  accountName: string;
  /** Symbols in this import that the account does not currently hold. */
  added: string[];
  /** Symbols in both — quantities and prices change, narrative does not. */
  updated: string[];
  /** Held now and absent from the import: these positions will be REMOVED. */
  removed: string[];
  /** NULL = the import carries no cash figure and the column is left alone. */
  cash: number | null;
};

/**
 * What one account's import will do, before it does it.
 *
 * Rule 29 asks for "previewed", and the word that earns the preview is
 * REMOVED. Added and updated rows are visible in the file the user just
 * chose; the positions about to disappear are not, and a mis-mapped account
 * is exactly how a portfolio gets emptied by a correct-looking import.
 */
export function previewImport(
  accountId: string,
  accountName: string,
  incoming: readonly ImportRow[],
  currentSymbols: readonly string[],
  cash: number | null,
): ImportPreview {
  const incomingSymbols = new Set(incoming.map((r) => r.symbol.toUpperCase()));
  const held = new Set(currentSymbols.map((s) => s.toUpperCase()));
  return {
    accountId,
    accountName,
    added: [...incomingSymbols].filter((s) => !held.has(s)).sort(),
    updated: [...incomingSymbols].filter((s) => held.has(s)).sort(),
    removed: [...held].filter((s) => !incomingSymbols.has(s)).sort(),
    cash,
  };
}

/**
 * Whether a preview is destructive enough to warrant an explicit confirmation.
 *
 * An import that removes everything the account holds is either a correct
 * "I sold it all" or a mapping mistake, and the two look identical in the UI.
 * The threshold is a PROPORTION plus a floor, not a count: "5 or more
 * removals" would nag a 300-position account and wave through a 4-position
 * one being emptied (rule 31 — no threshold tuned to one portfolio's size).
 */
export function isDestructive(preview: ImportPreview): boolean {
  const held = preview.updated.length + preview.removed.length;
  if (preview.removed.length === 0) return false;
  // Everything held is going, whatever the size.
  if (preview.updated.length === 0) return true;
  return preview.removed.length / held >= 0.5;
}

/**
 * Accounts an import is allowed to write, given the user's destination
 * choices.
 *
 * Rule 29's "an import to one account must not touch another", as data. The
 * code this replaces had a `fullOverwrite` mode that deleted EVERY holding the
 * user had — including accounts the import was not mapping and could not
 * restore — on the argument that a broker export is the complete portfolio.
 * It is not: a user may skip accounts, map only one, or hold positions at
 * another broker entirely.
 */
export function accountsInScope(destinations: readonly (string | null)[]): {
  scoped: string[];
  skipped: number;
} {
  const scoped = [...new Set(destinations.filter((d): d is string => d !== null))];
  return { scoped, skipped: destinations.filter((d) => d === null).length };
}

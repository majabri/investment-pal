// Resolving the scanned symbol set.
//
// `earnings.tsx` and `opportunities.tsx` each hardcoded the same 24 symbols,
// duplicated verbatim, while `investment_universe` existed as a table, was
// typed in `src/lib/types/universe.ts`, and was queried by nothing. Sell a
// position or add a name and both pages kept scanning a frozen list — wrong
// silently, which is the worst way for a screen about real money to be wrong.
//
// Pure so the union rules are testable without a database.

/**
 * Canonical form of a ticker.
 *
 * Exported because callers that build a "held" set from raw holdings MUST use
 * it too. `holdings.symbol` has no casing constraint, so a set built from raw
 * values missed normalised scan symbols and the "Held" badge silently vanished
 * — the position was still owned, the screen just stopped saying so.
 */
export function normaliseSymbol(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toUpperCase() : "";
}

/** A lookup set of held symbols, in the same form the scan list uses. */
export function heldSymbolSet(heldSymbols: readonly string[]): Set<string> {
  return new Set(heldSymbols.map(normaliseSymbol).filter(Boolean));
}

/** The scanned set: the stored universe plus everything currently held. */
export function resolveUniverse(
  universeSymbols: readonly string[],
  heldSymbols: readonly string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Held names come first: a position you own is never merely a candidate.
  for (const raw of [...heldSymbols, ...universeSymbols]) {
    const symbol = normaliseSymbol(raw);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

/**
 * Why the scan list is empty, when it is.
 *
 * The three cases need different copy: an unconfigured universe is a setup
 * task, an empty universe with holdings is not empty at all, and a genuinely
 * empty account is neither. A single blank table would say none of that.
 */
export function universeEmptyReason(
  universeSymbols: readonly string[],
  heldSymbols: readonly string[],
): "none-configured" | "holdings-only" | null {
  const hasUniverse = universeSymbols.some((s) => s?.trim());
  const hasHeld = heldSymbols.some((s) => s?.trim());
  if (!hasUniverse && !hasHeld) return "none-configured";
  if (!hasUniverse && hasHeld) return "holdings-only";
  return null;
}

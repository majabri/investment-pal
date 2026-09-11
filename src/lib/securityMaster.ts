// Instrument identity, and the one sector classification (UNIV-001 / DATA-001).
//
// The tables are `securities` and `security_aliases` (migration
// 20260910170000). This module is the two things a schema cannot enforce:
// which security a label resolves to on a given date, and which of the
// competing sector answers wins.
//
// Both are refusals as much as resolutions. An alias that resolves to two
// securities returns `ambiguous`, not the newest one — attaching one company's
// prices to another company's position is exactly the failure DATA-001 names,
// and a wrong answer here is invisible afterwards.
import { isRealCalendarDate, localIsoDate } from "./localDate";
import { SECTOR_MAP } from "./data/sectors";

/** What kind of instrument. Decides which arithmetic is even meaningful. */
export type AssetClass = "equity" | "etf" | "fund" | "crypto" | "cash" | "other";

/** Where a sector answer came from. Ordered by precedence below. */
export type SectorSource = "user" | "provider" | "builtin_map";

/** A security, in the shape resolution needs. */
export type Security = {
  id: string;
  canonicalSymbol: string;
  assetClass: AssetClass;
  sector: string | null;
  sectorSource: SectorSource | null;
  delistedAt: string | null;
};

/** How a label was spelled, and when it pointed at its security. */
export type SecurityAlias = {
  securityId: string;
  alias: string;
  aliasKind: "ticker" | "cusip" | "isin" | "figi" | "broker_label";
  /** NULL = has always pointed here. */
  validFrom: string | null;
  /** NULL = still does. */
  validTo: string | null;
};

/**
 * What a label resolved to.
 *
 * `ambiguous` exists because the honest answer to "two securities both claim
 * this ticker on this date" is not one of them. The unique index on open
 * windows makes it unreachable for CURRENT labels; it stays reachable for
 * historical ones, where two closed windows can genuinely overlap if an import
 * got a date wrong, and that is when it matters most.
 */
export type SecurityResolution =
  | { kind: "resolved"; securityId: string }
  | { kind: "unknown"; alias: string }
  | { kind: "ambiguous"; alias: string; securityIds: string[] };

/** Labels compare case-insensitively and without surrounding space. */
function normaliseAlias(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Whether `on` falls inside an alias's window. Both bounds are inclusive. */
function windowCovers(alias: SecurityAlias, on: string): boolean {
  if (alias.validFrom !== null && on < alias.validFrom) return false;
  if (alias.validTo !== null && on > alias.validTo) return false;
  return true;
}

/**
 * Which security a label meant on a given date.
 *
 * `on` defaults to today on the HOLDER'S calendar, not UTC — an alias window
 * is a range of calendar dates, and taking today from `toISOString()` would
 * shift it by a day every evening west of Greenwich (P0-04).
 */
export function resolveSecurity(
  rawAlias: string,
  aliases: readonly SecurityAlias[],
  on: string = localIsoDate(),
): SecurityResolution {
  const alias = normaliseAlias(rawAlias);
  if (alias === "") return { kind: "unknown", alias };
  // A malformed date would silently exclude every window and report the label
  // as unknown — a wrong answer wearing the right words.
  const date = isRealCalendarDate(on) ? on : localIsoDate();

  const ids = new Set<string>();
  for (const a of aliases) {
    if (normaliseAlias(a.alias) !== alias) continue;
    if (!windowCovers(a, date)) continue;
    ids.add(a.securityId);
  }
  if (ids.size === 0) return { kind: "unknown", alias };
  if (ids.size > 1) return { kind: "ambiguous", alias, securityIds: [...ids].sort() };
  return { kind: "resolved", securityId: [...ids][0] };
}

/**
 * Precedence for the ONE sector answer (UNIV-001).
 *
 * A human beats a data provider beats the built-in map. The order is here, as
 * data, rather than spelled out in an `if` chain at each call site — four call
 * sites with four orders is how two classifications became a problem worth a
 * requirement.
 */
export const SECTOR_PRECEDENCE: readonly SectorSource[] = ["user", "provider", "builtin_map"];

/** A sector, and which source produced it. */
export type SectorAnswer = {
  sector: string;
  source: SectorSource | null;
};

/** The label for a security nobody has classified. A known unknown. */
export const UNCLASSIFIED = "Unclassified";

/**
 * The canonical sector for a symbol.
 *
 * Sources, in precedence order:
 *
 *   1. `securities.sector` where `sector_source` is `user` — somebody looked.
 *   2. `holdings.sector`, the legacy per-holding override, also a human.
 *   3. `securities.sector` from a provider.
 *   4. The built-in map in `data/sectors.ts`.
 *
 * The legacy holding override sits at 2 rather than being dropped: it is the
 * only classification the app has today and discarding it on the day the
 * securities table arrives would silently reclassify real positions. It is
 * reported with source `user`, which is what it is.
 *
 * Never guesses. An unrecognised symbol is `Unclassified` with a NULL source,
 * which is distinguishable from a human classifying something as Unclassified.
 */
export function canonicalSector(
  symbol: string,
  opts: { security?: Security | null; holdingSector?: string | null } = {},
): SectorAnswer {
  const { security = null, holdingSector = null } = opts;

  if (security?.sector && security.sectorSource === "user") {
    return { sector: security.sector, source: "user" };
  }
  const legacy = holdingSector?.trim();
  if (legacy) return { sector: legacy, source: "user" };

  if (security?.sector && security.sectorSource === "provider") {
    return { sector: security.sector, source: "provider" };
  }

  const builtin = SECTOR_MAP[normaliseAlias(symbol)];
  if (builtin) return { sector: builtin, source: "builtin_map" };

  // CUSIP-shaped labels are the dead positions from the pre-2020 broker
  // exports. Recognising the SHAPE is not classifying the company, so this
  // keeps `builtin_map` as its source rather than claiming a human said so.
  const s = normaliseAlias(symbol);
  if (/^[0-9A-Z]{9}$/.test(s) && /\d/.test(s)) {
    return { sector: "Legacy / delisted", source: "builtin_map" };
  }

  return { sector: UNCLASSIFIED, source: null };
}

/**
 * Whether a security is still live on a date.
 *
 * Delisting is a state, not a deletion: a delisted position, its history and
 * the decisions attached to it all survive (rule 29). `null` delisted_at means
 * still listed, and a date in the future means still listed TODAY.
 */
export function isListed(security: Security, on: string = localIsoDate()): boolean {
  if (security.delistedAt === null) return true;
  return on < security.delistedAt;
}

// ---------------------------------------------------------------------------
// Backfill (UNIV-001 / DATA-001, write side)
// ---------------------------------------------------------------------------
//
// `securities` and `security_aliases` shipped as tables with zero call sites:
// nothing read them, nothing wrote them, every `security_id` was NULL, and
// symbol stayed the de facto identity. The resolver above was imported by
// nothing outside its own tests. This is the first half of making it real —
// giving each held symbol a stable id, with the symbol demoted to an alias.
//
// The plan is computed as a pure value, separately from applying it, because
// the interesting decisions are all here: what already resolves, what is
// ambiguous, and what may be created. A mutation that decided those inline
// would be untestable at exactly the points where guessing is a defect.

/** What a backfill would do. Nothing is created for a label that resolves. */
export type BackfillPlan = {
  /** Labels with no security yet. Each becomes one security and one alias. */
  create: string[];
  /** Labels that already resolve. Left alone — re-creating one would fork it. */
  alreadyResolved: string[];
  /**
   * Labels that two securities both claim.
   *
   * NOT created and NOT linked. `resolveSecurity` returns `ambiguous` rather
   * than the newest match for a reason, and a backfill that broke the tie by
   * inventing a third security would make the ambiguity permanent.
   */
  ambiguous: string[];
};

/**
 * What to create so every held label resolves.
 *
 * Deduplicated case-insensitively through `normaliseAlias`, so `aapl` and
 * `AAPL` are one security rather than two — the exact fork DATA-001 exists to
 * prevent.
 */
export function planBackfill(
  rawSymbols: readonly string[],
  aliases: readonly SecurityAlias[],
  on: string = localIsoDate(),
): BackfillPlan {
  const create: string[] = [];
  const alreadyResolved: string[] = [];
  const ambiguous: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawSymbols) {
    const alias = normaliseAlias(raw);
    if (alias === "") continue;
    if (seen.has(alias)) continue;
    seen.add(alias);

    const res = resolveSecurity(alias, aliases, on);
    if (res.kind === "resolved") alreadyResolved.push(alias);
    else if (res.kind === "ambiguous") ambiguous.push(alias);
    else create.push(alias);
  }

  return {
    create: create.sort(),
    alreadyResolved: alreadyResolved.sort(),
    ambiguous: ambiguous.sort(),
  };
}

/**
 * The asset class a backfilled security starts in.
 *
 * `other`, always — deliberately not guessed from the symbol. A four-letter
 * ticker is not an ETF and a five-letter one is not a fund; those heuristics
 * are wrong often enough that a wrong class would propagate into every screen
 * that groups by it. `other` is the enum's least-claiming member and the holder
 * can correct it. There is no `unknown` member to reach for, which is a schema
 * limitation worth recording rather than papering over with a guess.
 */
export const BACKFILL_ASSET_CLASS: AssetClass = "other";

/** The `securities` row a backfill creates for one label. */
export function securityInsert(input: {
  userId: string | undefined;
  canonicalSymbol: string;
}): Record<string, unknown> {
  return {
    user_id: input.userId ?? null,
    canonical_symbol: normaliseAlias(input.canonicalSymbol),
    asset_class: BACKFILL_ASSET_CLASS,
    // Sector is left NULL rather than run through the built-in map here. The
    // map is a FALLBACK that `canonicalSector` applies at read time behind a
    // user or provider answer; writing its output into the table would promote
    // a guess to a stored fact and lose that precedence.
    sector: null,
    sector_source: null,
  };
}

/** The `security_aliases` row that points a label at its security. */
export function aliasInsert(input: {
  userId: string | undefined;
  securityId: string;
  alias: string;
}): Record<string, unknown> {
  return {
    user_id: input.userId ?? null,
    security_id: input.securityId,
    alias: normaliseAlias(input.alias),
    alias_kind: "ticker",
    // `derived`, not `imported`: nobody sent us this mapping, the app inferred
    // it from a symbol already sitting on a holding. Calling it imported would
    // credit a broker with a link the broker never made. (The CHECK allows
    // imported | user_entry | derived, and the column has no default — an
    // omitted `source` is a NOT NULL violation at insert time, which types.ts
    // marks required and nothing else would have caught until it ran.)
    source: "derived",
    // NULL/NULL is "has always pointed here and still does". A backfill has no
    // evidence of when the mapping began, and inventing a start date would make
    // every historical resolution before it fail.
    valid_from: null,
    valid_to: null,
  };
}

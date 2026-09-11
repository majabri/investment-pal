// A ticker is a label, not an identity (UNIV-001 / DATA-001).
//
// Every table in this app is keyed on the ticker — holdings, price_history,
// investment_universe, strategy_symbols, watchlist. Tickers are renamed and
// recycled, so that key silently merges and splits real instruments:
//
//   * FB became META in 2022. Two rows, two price histories, one company.
//   * A delisted shell's ticker is reissued, and the old position's history
//     continues under a different company's prices.
//
// These pin the resolution, and — more importantly — the refusals.
import { describe, expect, test } from "bun:test";
import {
  BACKFILL_ASSET_CLASS,
  SECTOR_PRECEDENCE,
  UNCLASSIFIED,
  aliasInsert,
  canonicalSector,
  isListed,
  planBackfill,
  resolveSecurity,
  securityInsert,
} from "@/lib/securityMaster";
import type { Security, SecurityAlias } from "@/lib/securityMaster";

// Synthetic identities (ADR-APP-012 rules 23-25).
const META = "sec-meta";
const SHELL = "sec-old-shell";
const REISSUED = "sec-new-issuer";

const aliases: SecurityAlias[] = [
  // A rename: one company, two labels, adjacent windows.
  { securityId: META, alias: "FB", aliasKind: "ticker", validFrom: null, validTo: "2022-06-08" },
  { securityId: META, alias: "META", aliasKind: "ticker", validFrom: "2022-06-09", validTo: null },
  // A recycled ticker: the old issuer's window is CLOSED, the new one is open.
  { securityId: SHELL, alias: "XYZ", aliasKind: "ticker", validFrom: null, validTo: "2021-03-31" },
  {
    securityId: REISSUED,
    alias: "XYZ",
    aliasKind: "ticker",
    validFrom: "2023-01-01",
    validTo: null,
  },
  // A broker CUSIP for the same company as META.
  { securityId: META, alias: "30303M102", aliasKind: "cusip", validFrom: null, validTo: null },
];

describe("resolveSecurity — a rename is one company", () => {
  test("FB in 2019 and META in 2026 are the same security", () => {
    const then = resolveSecurity("FB", aliases, "2019-05-01");
    const now = resolveSecurity("META", aliases, "2026-09-10");
    expect(then).toEqual({ kind: "resolved", securityId: META });
    expect(now).toEqual({ kind: "resolved", securityId: META });
  });

  test("the old label stops resolving after the window closes", () => {
    expect(resolveSecurity("FB", aliases, "2026-09-10")).toEqual({
      kind: "unknown",
      alias: "FB",
    });
  });

  test("window bounds are inclusive on both ends", () => {
    expect(resolveSecurity("FB", aliases, "2022-06-08").kind).toBe("resolved");
    expect(resolveSecurity("FB", aliases, "2022-06-09").kind).toBe("unknown");
    expect(resolveSecurity("META", aliases, "2022-06-09").kind).toBe("resolved");
    expect(resolveSecurity("META", aliases, "2022-06-08").kind).toBe("unknown");
  });

  test("a CUSIP resolves to the same security as the ticker", () => {
    // The defect this prevents: the broker exports a CUSIP in one report and a
    // ticker in another, and the app holds the position twice.
    expect(resolveSecurity("30303M102", aliases)).toEqual({
      kind: "resolved",
      securityId: META,
    });
  });

  test("labels compare case- and space-insensitively", () => {
    expect(resolveSecurity("  meta ", aliases, "2026-09-10")).toEqual({
      kind: "resolved",
      securityId: META,
    });
  });
});

describe("resolveSecurity — a recycled ticker never crosses", () => {
  test("XYZ in 2020 is the shell, XYZ in 2026 is the new issuer", () => {
    expect(resolveSecurity("XYZ", aliases, "2020-06-01")).toEqual({
      kind: "resolved",
      securityId: SHELL,
    });
    expect(resolveSecurity("XYZ", aliases, "2026-06-01")).toEqual({
      kind: "resolved",
      securityId: REISSUED,
    });
  });

  test("the gap between the two windows resolves to NEITHER", () => {
    // 2021-04-01 to 2022-12-31: the shell is gone and the reissue has not
    // happened. Picking either would attach real prices to the wrong company.
    expect(resolveSecurity("XYZ", aliases, "2022-01-15")).toEqual({
      kind: "unknown",
      alias: "XYZ",
    });
  });
});

describe("resolveSecurity — refusals", () => {
  test("two securities claiming one label on one date is AMBIGUOUS, not the newest", () => {
    // Reachable when an import gets a date wrong. The wrong answer here is
    // invisible afterwards, which is why it is not guessed at.
    const overlapping: SecurityAlias[] = [
      {
        securityId: "a",
        alias: "DUP",
        aliasKind: "ticker",
        validFrom: null,
        validTo: "2026-12-31",
      },
      {
        securityId: "b",
        alias: "DUP",
        aliasKind: "ticker",
        validFrom: "2026-01-01",
        validTo: null,
      },
    ];
    const r = resolveSecurity("DUP", overlapping, "2026-06-01");
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") throw new Error("kind");
    expect(r.securityIds).toEqual(["a", "b"]);
  });

  test("an unknown label is unknown, not a new security", () => {
    expect(resolveSecurity("NOPE", aliases)).toEqual({ kind: "unknown", alias: "NOPE" });
  });

  test("an empty label resolves to nothing", () => {
    expect(resolveSecurity("   ", aliases).kind).toBe("unknown");
  });

  test("an impossible date falls back to today rather than matching nothing", () => {
    // A malformed date would exclude every window and report a real label as
    // unknown — a wrong answer wearing the right words.
    expect(resolveSecurity("META", aliases, "2026-02-31").kind).toBe("resolved");
  });
});

describe("canonicalSector — one classification, with provenance", () => {
  const sec = (over: Partial<Security>): Security => ({
    id: META,
    canonicalSymbol: "META",
    assetClass: "equity",
    sector: null,
    sectorSource: null,
    delistedAt: null,
    ...over,
  });

  test("a human on the security beats everything", () => {
    expect(
      canonicalSector("NVDA", {
        security: sec({ sector: "AI Infrastructure", sectorSource: "user" }),
        holdingSector: "Something else",
      }),
    ).toEqual({ sector: "AI Infrastructure", source: "user" });
  });

  test("the legacy per-holding sector is honoured, and reported as a human's", () => {
    // Dropping it on the day the securities table arrives would silently
    // reclassify real positions.
    expect(
      canonicalSector("NVDA", {
        security: sec({ sector: "Technology", sectorSource: "provider" }),
        holdingSector: "  My own bucket  ",
      }),
    ).toEqual({ sector: "My own bucket", source: "user" });
  });

  test("a provider beats the built-in map", () => {
    expect(
      canonicalSector("NVDA", {
        security: sec({ sector: "Technology", sectorSource: "provider" }),
      }),
    ).toEqual({ sector: "Technology", source: "provider" });
  });

  test("the built-in map is the last resort, and says so", () => {
    expect(canonicalSector("NVDA")).toEqual({ sector: "Semiconductors", source: "builtin_map" });
  });

  test("an unknown symbol is Unclassified with a NULL source", () => {
    // Distinguishable from a human who looked and said "Unclassified".
    expect(canonicalSector("ZZZZ")).toEqual({ sector: UNCLASSIFIED, source: null });
    expect(canonicalSector("ZZZZ", { holdingSector: UNCLASSIFIED })).toEqual({
      sector: UNCLASSIFIED,
      source: "user",
    });
  });

  test("a CUSIP-shaped label is recognised by SHAPE, and does not claim a human said so", () => {
    expect(canonicalSector("30303M102")).toEqual({
      sector: "Legacy / delisted",
      source: "builtin_map",
    });
  });

  test("an empty holding sector is not an override", () => {
    expect(canonicalSector("NVDA", { holdingSector: "   " }).source).toBe("builtin_map");
  });

  test("the precedence order is data, not four if-chains", () => {
    expect(SECTOR_PRECEDENCE).toEqual(["user", "provider", "builtin_map"]);
  });
});

describe("isListed", () => {
  const s = (delistedAt: string | null): Security => ({
    id: "s",
    canonicalSymbol: "X",
    assetClass: "equity",
    sector: null,
    sectorSource: null,
    delistedAt,
  });

  test("no delisting date means listed", () => {
    expect(isListed(s(null), "2026-09-10")).toBe(true);
  });

  test("delisting is a state change, checked against a date", () => {
    expect(isListed(s("2026-06-01"), "2026-05-31")).toBe(true);
    expect(isListed(s("2026-06-01"), "2026-06-01")).toBe(false);
    expect(isListed(s("2026-06-01"), "2026-09-10")).toBe(false);
  });
});

// Backfill (UNIV-001 / DATA-001, write side).
//
// The tables shipped with zero call sites: nothing read them, nothing wrote
// them, every `security_id` was NULL and symbol stayed the de facto identity.
describe("planBackfill", () => {
  const alias = (securityId: string, a: string): SecurityAlias => ({
    securityId,
    alias: a,
    aliasKind: "ticker",
    validFrom: null,
    validTo: null,
  });

  test("NEGATIVE CONTROL: an unknown label is planned for creation", () => {
    // Without this, every skip below passes on a planner that creates nothing.
    expect(planBackfill(["AAA"], []).create).toEqual(["AAA"]);
  });

  test("a label that already resolves is left alone", () => {
    // Re-creating it would fork the identity — the defect the table prevents.
    const p = planBackfill(["AAA"], [alias("s1", "AAA")]);
    expect(p.create).toEqual([]);
    expect(p.alreadyResolved).toEqual(["AAA"]);
  });

  test("case and whitespace do not fork a security", () => {
    const p = planBackfill(["aapl", "AAPL", "  Aapl  "], []);
    expect(p.create).toEqual(["AAPL"]);
  });

  test("an ambiguous label is neither created nor resolved", () => {
    // Two securities claim it. Creating a third would make that permanent.
    const p = planBackfill(["AAA"], [alias("s1", "AAA"), alias("s2", "AAA")]);
    expect(p.ambiguous).toEqual(["AAA"]);
    expect(p.create).toEqual([]);
    expect(p.alreadyResolved).toEqual([]);
  });

  test("it is idempotent — the second run plans nothing", () => {
    const first = planBackfill(["AAA", "BBB"], []);
    expect(first.create).toEqual(["AAA", "BBB"]);
    const after = [alias("s1", "AAA"), alias("s2", "BBB")];
    expect(planBackfill(["AAA", "BBB"], after).create).toEqual([]);
  });

  test("empty and blank labels are skipped, not created", () => {
    expect(planBackfill(["", "   ", "AAA"], []).create).toEqual(["AAA"]);
  });

  test("a label whose alias window has closed is created, not resolved", () => {
    // The alias pointed there once and no longer does. Treating a closed
    // window as current would attach today's holding to a retired identity.
    const closed: SecurityAlias = { ...alias("s1", "AAA"), validTo: "2020-01-01" };
    expect(planBackfill(["AAA"], [closed], "2026-09-11").create).toEqual(["AAA"]);
  });
});

describe("securityInsert / aliasInsert", () => {
  test("a backfilled security carries NO sector", () => {
    // The built-in map is a FALLBACK that canonicalSector applies behind a user
    // or provider answer. Writing its output here would promote a guess to a
    // stored fact and destroy that precedence.
    const row = securityInsert({ userId: "u1", canonicalSymbol: "AAA" });
    expect(row.sector).toBeNull();
    expect(row.sector_source).toBeNull();
  });

  test("asset class is `other`, never guessed from the symbol", () => {
    // A four-letter ticker is not an ETF. There is no `unknown` member, so the
    // least-claiming one is used and the holder can correct it.
    expect(securityInsert({ userId: "u1", canonicalSymbol: "AAA" }).asset_class).toBe("other");
    expect(BACKFILL_ASSET_CLASS).toBe("other");
  });

  test("the canonical symbol is normalised", () => {
    expect(securityInsert({ userId: "u1", canonicalSymbol: "  aaa " }).canonical_symbol).toBe("AAA");
  });

  test("an alias carries a source, because the column is NOT NULL", () => {
    // Omitting it is a constraint violation that only appears at insert time.
    const row = aliasInsert({ userId: "u1", securityId: "s1", alias: "AAA" });
    expect(row.source).toBe("derived");
    // Not `imported` — no broker sent us this mapping, the app inferred it.
    expect(row.source).not.toBe("imported");
  });

  test("an alias window is open at both ends", () => {
    // A backfill has no evidence of when the mapping began, and inventing a
    // start date would make every resolution before it fail.
    const row = aliasInsert({ userId: "u1", securityId: "s1", alias: "AAA" });
    expect(row.valid_from).toBeNull();
    expect(row.valid_to).toBeNull();
  });

  test("the alias round-trips through resolveSecurity", () => {
    // The whole point: what the backfill writes must be what the resolver
    // reads. Asserting the shape alone would not catch a field-name drift.
    const row = aliasInsert({ userId: "u1", securityId: "s1", alias: "  AAA " });
    const res = resolveSecurity("AAA", [
      {
        securityId: row.security_id as string,
        alias: row.alias as string,
        aliasKind: "ticker",
        validFrom: null,
        validTo: null,
      },
    ]);
    expect(res).toEqual({ kind: "resolved", securityId: "s1" });
  });
});

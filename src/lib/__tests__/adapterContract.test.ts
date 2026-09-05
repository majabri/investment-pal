// The contract is only worth having if a second broker can satisfy it without
// portfolio logic being touched. Rule 28 asks for that to be PROVEN with a
// synthetic fixture rather than asserted in a comment — so this file contains a
// complete second adapter for a broker that does not exist, written only
// against `contract.ts`, and then runs the same assertions over both.
import { describe, expect, test } from "bun:test";

import { fidelityAdapter } from "../adapters/fidelity";
import type { AdapterResult, BrokerAdapter } from "../adapters/contract";
import { emptyCanonicalBalance, type CanonicalBalance } from "../canonicalBalances";

// ── the synthetic second broker ──────────────────────────────────────────────
//
// Deliberately unlike Fidelity in every way that matters: key=value lines
// instead of prose labels, its own names, a debit printed POSITIVE where
// Fidelity prints it negative, and figures in a currency that is not USD.
// An adapter that only works for brokers shaped like the first one proves
// nothing.
const NORTHWIND_BLOCK = `
holdings_value=145950.00
uninvested=2500.00
loan_outstanding=20000.00
net_worth=128450.00
tradeable_headroom=190000.00
denomination=GBP
`.trim();

function num(raw: string, key: string): number | null {
  const m = new RegExp(`^${key}=(-?[0-9.]+)$`, "m").exec(raw);
  return m ? Number(m[1]) : null;
}

const northwindAdapter: BrokerAdapter = {
  id: "northwind",
  displayName: "Northwind Securities",
  canRead: (raw) => /^net_worth=/m.test(raw),
  read(raw, asOf = new Date()) {
    const b = emptyCanonicalBalance();
    b.brokerReportedEquity = num(raw, "net_worth");
    b.securitiesMarketValue = num(raw, "holdings_value");
    b.cash.total = num(raw, "uninvested");
    // Already positive in this broker's format. The canonical model requires a
    // positive magnitude, so this adapter does nothing where Fidelity's negates
    // — which is exactly the per-broker difference the contract exists to
    // absorb.
    b.marginDebt = num(raw, "loan_outstanding");
    b.informational.marginBuyingPower = num(raw, "tradeable_headroom");
    b.currency = /^denomination=(\w+)$/m.exec(raw)?.[1] ?? null;
    b.asOf = asOf.toISOString();
    return { canonical: b, recognised: ["net_worth"], findings: [] };
  },
};

// ── portfolio logic, written against the canonical model only ────────────────
//
// This is the thing that must not need editing when a broker is added. It
// never mentions a broker, a field name, or a sign convention.
function equityFrom(b: CanonicalBalance): number | null {
  if (b.cash.total === null || b.securitiesMarketValue === null || b.marginDebt === null) {
    return null;
  }
  return b.cash.total + b.securitiesMarketValue - b.marginDebt;
}

const FIDELITY_BLOCK = [
  "Cash market value $2,500.00",
  "Margin market value $145,950.00",
  "Net debit −$20,000.00",
  "Total account value $128,450.00",
  "Margin buying power $190,000.00",
].join("\n");

const AS_OF = new Date("2026-09-05T12:00:00Z");

describe("a second adapter needs no change to portfolio logic", () => {
  const both: Array<[BrokerAdapter, string]> = [
    [fidelityAdapter, FIDELITY_BLOCK],
    [northwindAdapter, NORTHWIND_BLOCK],
  ];

  for (const [adapter, block] of both) {
    test(`${adapter.id}: the same arithmetic reaches the same answer`, () => {
      const { canonical } = adapter.read(block, AS_OF);
      // Both blocks describe the same account in different words. The function
      // computing equity has never heard of either broker.
      expect(equityFrom(canonical)).toBeCloseTo(128_450, 2);
    });

    test(`${adapter.id}: the debt is a positive magnitude whatever the broker printed`, () => {
      // Fidelity prints it negative and Northwind positive. The canonical model
      // takes one convention and each adapter absorbs the difference — a sign
      // error on a loan is silent and the size of the whole loan.
      const { canonical } = adapter.read(block, AS_OF);
      expect(canonical.marginDebt).toBe(20_000);
    });

    test(`${adapter.id}: the two equities stay apart`, () => {
      const { canonical } = adapter.read(block, AS_OF);
      expect(canonical.brokerReportedEquity).toBe(128_450);
      // The adapter never fills the app's own figure. It reports what the broker
      // said; computing is not its job, and a record where both came from the
      // same place cannot be reconciled.
      expect(canonical.appCalculatedEquity).toBeNull();
    });

    test(`${adapter.id}: buying power never reaches the components`, () => {
      const { canonical } = adapter.read(block, AS_OF);
      expect(canonical.informational.marginBuyingPower).toBe(190_000);
      // Rule 8, structurally: it is not in the same object as the components,
      // so equityFrom cannot see it.
      expect(equityFrom(canonical)).not.toBe(318_450);
    });

    test(`${adapter.id}: it states its own currency rather than assuming one`, () => {
      const { canonical } = adapter.read(block, AS_OF);
      expect(canonical.currency).not.toBeNull();
    });

    test(`${adapter.id}: it stamps when the figures were true`, () => {
      expect(adapter.read(block, AS_OF).canonical.asOf).toBe(AS_OF.toISOString());
    });
  }

  test("the two brokers really are different formats", () => {
    // Guards the fixture itself. If Northwind's block drifted into Fidelity's
    // shape the pair would prove nothing, and the tests above would still pass.
    expect(fidelityAdapter.canRead(NORTHWIND_BLOCK)).toBe(false);
    expect(northwindAdapter.canRead(FIDELITY_BLOCK)).toBe(false);
    expect(fidelityAdapter.canRead(FIDELITY_BLOCK)).toBe(true);
    expect(northwindAdapter.canRead(NORTHWIND_BLOCK)).toBe(true);
  });

  test("they disagree about currency, and both are believed", () => {
    // USD-only implementation is acceptable; USD-ASSUMED architecture is not
    // (rule 32). The second adapter reports GBP and nothing overrides it.
    expect(fidelityAdapter.read(FIDELITY_BLOCK, AS_OF).canonical.currency).toBe("USD");
    expect(northwindAdapter.read(NORTHWIND_BLOCK, AS_OF).canonical.currency).toBe("GBP");
  });
});

describe("the adapter reports what it could not vouch for", () => {
  test("a broken identity is a finding, not a silent record", () => {
    const swapped = [
      "Cash market value $2,500.00",
      // Securities and debt transposed — the rule-8 mistake.
      "Margin market value $20,000.00",
      "Net debit −$145,950.00",
      "Total account value $128,450.00",
    ].join("\n");
    const r = fidelityAdapter.read(swapped, AS_OF);
    expect(r.findings.some((f) => f.kind === "identity_failed")).toBe(true);
    // And it still returns the record: a suspect read is a result to look at,
    // not an exception that throws away what was read.
    expect(r.canonical.brokerReportedEquity).toBe(128_450);
  });

  test("a clean block produces no findings", () => {
    // The other direction. A validator that always finds something is a
    // validator nobody reads.
    expect(fidelityAdapter.read(FIDELITY_BLOCK, AS_OF).findings).toEqual([]);
  });

  test("an unsupported field present in the paste is called out", () => {
    const withSurplus = `${FIDELITY_BLOCK}\nNet house surplus $12,000.00`;
    const r = fidelityAdapter.read(withSurplus, AS_OF);
    expect(r.findings.some((f) => f.kind === "unsupported_field")).toBe(true);
    // Carried, so nothing is lost...
    expect(r.canonical.informational.houseSurplus).toBe(12_000);
    // ...and outside the components, so nothing can calculate with it.
    expect(equityFrom(r.canonical)).toBeCloseTo(128_450, 2);
  });
});

describe("canRead declines rather than guessing", () => {
  test("prose that is not a balance block is not claimed", () => {
    // An adapter claiming text it cannot read yields a confidently EMPTY record
    // instead of an unhandled one, which is the worse of the two failures.
    expect(fidelityAdapter.canRead("Dear customer, your statement is attached.")).toBe(false);
    expect(fidelityAdapter.canRead("")).toBe(false);
  });

  test("a single stray figure is not enough to claim a paste", () => {
    expect(fidelityAdapter.canRead("Total account value $128,450.00")).toBe(false);
  });
});

describe("the contract is one call, not three", () => {
  test("an adapter exposes no way to map without validating", () => {
    // The design decision this file exists to protect. Separate parse/validate/
    // map methods read better and let a caller skip the validation, which is
    // the only thing between a mis-parse and a plausible wrong total.
    const keys = Object.keys(fidelityAdapter).sort();
    expect(keys).toEqual(["canRead", "displayName", "id", "read"]);
  });

  test("every read returns findings, even when empty", () => {
    const r: AdapterResult = fidelityAdapter.read(FIDELITY_BLOCK, AS_OF);
    expect(Array.isArray(r.findings)).toBe(true);
  });
});

// Stage 2. The fixture is a SYNTHETIC Fidelity-shaped balance block — no real
// account, no real figures (P0 remediation, 2026-09-05). It is built so the
// parser cannot pass by accident: every field carries a distinct value, so a
// parser that maps two labels to one key fails; the rate differs from every
// rate the app has ever hardcoded, so a reintroduced constant fails; the cash
// term is non-trivial, so dropping it breaks reconciliation rather than
// rounding away; and the debit is large enough that a sign error produces an
// obviously wrong total instead of a near-miss.
import { describe, expect, test } from "bun:test";

import {
  accountPatch,
  balanceFragments,
  isDateOrTime,
  parseAmount,
  parseBalanceBlock,
  toSnapshot,
  isBareValue,
  isSectionHeading,
  BALANCE_FIELD_ORDER,
} from "../balanceImport";

// Synthetic, in the shape Fidelity's balances page prints.
// Reconciles exactly: 2,500.00 + 145,950.00 − 20,000.00 = 128,450.00
const FIXTURE = `Total account value $128,450.00
Day change +$1,234.56
Equity percentage 86.50%
Margin buying power $190,000.00
Non-margin buying power $95,000.00
Committed to open orders $7,500.00
Net house surplus $45,000.00
Margin interest accrued this month $175.00
Margin interest rate 9.750%
Cash market value $2,500.00
Margin market value $145,950.00
Net debit −$20,000.00`;

describe("the real balance block parses to the cent", () => {
  const p = parseBalanceBlock(FIXTURE);

  test("every field is found — nothing missing, nothing unrecognised", () => {
    expect(p.missing).toEqual([]);
    expect(p.unrecognised).toEqual([]);
    expect(p.empty).toBe(false);
  });

  test("each figure lands in its own column", () => {
    expect(p.fields).toEqual({
      totalAccountValue: 128_450,
      dayChange: 1_234.56,
      equityPct: 86.5,
      marginBuyingPower: 190_000,
      nonMarginBuyingPower: 95_000,
      committedToOpenOrders: 7_500,
      netHouseSurplus: 45_000,
      marginInterestAccruedMtd: 175,
      marginInterestRatePct: 9.75,
      cashMarketValue: 2_500,
      marginMarketValue: 145_950,
      netDebit: 20_000,
    });
  });

  test("the pasted figures reconcile with each other", () => {
    // cash + margin market value − debit = total account value. If the parser
    // dropped a figure into the wrong column this identity breaks, and it is
    // the only check that catches a swap between two plausible dollar amounts.
    const f = p.fields;
    expect(f.cashMarketValue! + f.marginMarketValue! - f.netDebit!).toBeCloseTo(
      f.totalAccountValue!,
      2,
    );
  });

  test("the debit is stored positive however Fidelity printed it", () => {
    // The app subtracts `margin_used`. A debit arriving negative would be
    // added, overstating the account by twice the loan.
    for (const spelling of ["−$20,000.00", "-$20,000.00", "($20,000.00)", "$20,000.00"]) {
      const q = parseBalanceBlock(`Net debit ${spelling}`);
      expect(q.fields.netDebit).toBe(20_000);
    }
  });

  test("the rate is a percentage, not a fraction", () => {
    // 9.75 vs 0.0975 is a factor of 100 on a money figure. Pin it.
    expect(p.fields.marginInterestRatePct).toBe(9.75);
  });
});

describe("labels that contain one another do not swallow each other", () => {
  test("non-margin buying power is not margin buying power", () => {
    const p = parseBalanceBlock(
      "Margin buying power $190,000.00\nNon-margin buying power $95,000.00",
    );
    expect(p.fields.marginBuyingPower).toBe(190_000);
    expect(p.fields.nonMarginBuyingPower).toBe(95_000);
  });

  test("order in the paste does not decide which is which", () => {
    // The reversed paste must produce the identical mapping. If it does not,
    // the parser is matching on position rather than on the label.
    const p = parseBalanceBlock(
      "Non-margin buying power $95,000.00\nMargin buying power $190,000.00",
    );
    expect(p.fields.marginBuyingPower).toBe(190_000);
    expect(p.fields.nonMarginBuyingPower).toBe(95_000);
  });

  test("margin market value is not the margin interest rate", () => {
    const p = parseBalanceBlock("Margin market value $145,950.00\nMargin interest rate 9.750%");
    expect(p.fields.marginMarketValue).toBe(145_950);
    expect(p.fields.marginInterestRatePct).toBe(9.75);
  });

  test("accrued interest is not the rate", () => {
    const p = parseBalanceBlock(
      "Margin interest accrued this month $175.00\nMargin interest rate 9.750%",
    );
    expect(p.fields.marginInterestAccruedMtd).toBe(175);
    expect(p.fields.marginInterestRatePct).toBe(9.75);
  });
});

describe("a partial paste is reported, never completed", () => {
  test("what is missing is named, and the rest still parses", () => {
    const p = parseBalanceBlock("Total account value $128,450.00\nCash market value $2,500.00");
    expect(p.fields.totalAccountValue).toBe(128_450);
    expect(p.fields.netDebit).toBeNull();
    expect(p.missing).toContain("netDebit");
    expect(p.missing).toContain("marginBuyingPower");
  });

  test("a missing figure is null, not zero", () => {
    // Zero is a claim: "this account has no margin loan". Null is the truth:
    // "the paste did not say". They must not be the same value.
    const p = parseBalanceBlock("Total account value $128,450.00");
    expect(p.fields.netDebit).toBeNull();
    expect(p.fields.netDebit).not.toBe(0);
  });

  test("an explicit zero is kept as zero", () => {
    const p = parseBalanceBlock("Net debit $0.00");
    expect(p.fields.netDebit).toBe(0);
    expect(p.missing).not.toContain("netDebit");
  });

  test("text that is not a balance block yields nothing and says so", () => {
    const p = parseBalanceBlock("Good morning. Here are my thoughts on the market.");
    expect(p.empty).toBe(true);
    expect(p.missing).toEqual(BALANCE_FIELD_ORDER);
  });

  test("an empty paste is empty, not a block of zeroes", () => {
    const p = parseBalanceBlock("");
    expect(p.empty).toBe(true);
    expect(Object.values(p.fields).every((v) => v === null)).toBe(true);
  });

  test("a renamed field is surfaced, not dropped", () => {
    // If Fidelity renames something, the value must not vanish silently — that
    // turns a rename into a figure that quietly stops updating.
    const p = parseBalanceBlock("Total account value $100.00\nSettled funds available $42.00");
    expect(p.unrecognised).toEqual(["Settled funds available $42.00"]);
  });

  test("headings and dates are ignored without being flagged", () => {
    const p = parseBalanceBlock("Balances\nAs of 09/03/2026\nTotal account value $128,450.00");
    expect(p.fields.totalAccountValue).toBe(128_450);
    // The date carries digits that parse perfectly well as "09". Flagging it as
    // unrecognised would fire the warning on every ordinary paste, and a
    // warning that always fires is one the user scrolls past — which is how the
    // real unrecognised line, the renamed field, gets missed.
    expect(p.unrecognised).toEqual([]);
  });

  test("every shape of timestamp is skipped, not read as a figure", () => {
    for (const stamp of [
      "As of 09/03/2026",
      "as of 2026-09-03",
      "Updated 4:15 PM ET",
      "Last updated 09-03-26",
    ]) {
      const p = parseBalanceBlock(`${stamp}\nTotal account value $128,450.00`);
      expect(p.unrecognised).toEqual([]);
      expect(p.fields.totalAccountValue).toBe(128_450);
    }
  });

  test("a timestamp alone is an empty parse, not a figure of 9", () => {
    expect(parseBalanceBlock("As of 09/03/2026").empty).toBe(true);
  });
});

describe("paste shapes", () => {
  test("the same block parses identically from lines, dots and pipes", () => {
    const lines = "Total account value $128,450.00\nCash market value $2,500.00";
    const dots = "Total account value $128,450.00 · Cash market value $2,500.00";
    const pipes = "Total account value $128,450.00 | Cash market value $2,500.00";
    const want = parseBalanceBlock(lines).fields;
    expect(parseBalanceBlock(dots).fields).toEqual(want);
    expect(parseBalanceBlock(pipes).fields).toEqual(want);
  });

  test("fragments drop blanks and keep the label with its number", () => {
    expect(balanceFragments("a $1\n\n  \nb $2")).toEqual(["a $1", "b $2"]);
  });
});

describe("isDateOrTime", () => {
  test("timestamps are timestamps", () => {
    expect(isDateOrTime("As of 09/03/2026")).toBe(true);
    expect(isDateOrTime("4:15 PM ET")).toBe(true);
    expect(isDateOrTime("2026-09-03")).toBe(true);
  });

  test("money is not a timestamp", () => {
    // The guard must not swallow a real figure. A dollar amount with a comma
    // and a decimal must never look like a date to it.
    expect(isDateOrTime("Total account value $128,450.00")).toBe(false);
    expect(isDateOrTime("Margin interest rate 9.750%")).toBe(false);
    expect(isDateOrTime("Net debit −$20,000.00")).toBe(false);
  });
});

describe("parseAmount", () => {
  test("reads dollars, percentages and plain numbers", () => {
    expect(parseAmount("$128,450.00")).toBe(128_450);
    expect(parseAmount("86.50%")).toBe(86.5);
    expect(parseAmount("1234.56")).toBe(1_234.56);
  });

  test("all three negative spellings are negative", () => {
    expect(parseAmount("-$20,000.00")).toBe(-20_000);
    expect(parseAmount("−$20,000.00")).toBe(-20_000); // U+2212, what the site emits
    expect(parseAmount("($20,000.00)")).toBe(-20_000);
  });

  test("a leading plus is positive, not dropped into a negative", () => {
    expect(parseAmount("+$1,234.56")).toBe(1_234.56);
  });

  test("text with no number is null, not zero", () => {
    expect(parseAmount("Total account value")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});

describe("what an import writes back", () => {
  const AS_OF = new Date("2026-09-05T12:00:00Z");
  /** Just the money, for the assertions that are about the money. */
  const money = (patch: Record<string, number | string>) =>
    Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === "number"));

  test("only the columns the paste supplied", () => {
    const p = parseBalanceBlock(FIXTURE);
    expect(money(accountPatch(p.fields, AS_OF))).toEqual({
      cash: 2_500,
      margin_used: 20_000,
      buying_power: 190_000,
    });
  });

  test("a missing figure writes nothing, rather than zero over a real balance", () => {
    // This is the silent-partial-accept failure in one test: a paste with no
    // cash line must not set cash to 0.
    const p = parseBalanceBlock("Net debit −$20,000.00");
    const patch = accountPatch(p.fields, AS_OF);
    expect("cash" in patch).toBe(false);
    expect(money(patch)).toEqual({ margin_used: 20_000 });
  });

  test("an all-missing paste writes nothing at all", () => {
    // Provenance included. Stamping "imported snapshot, as of now" over figures
    // this paste did not supply would date somebody else's numbers to this
    // import (Phase 1d).
    expect(accountPatch(parseBalanceBlock("").fields, AS_OF)).toEqual({});
  });

  test("provenance travels with the figures, in the same patch", () => {
    // Two writes could half-fail, leaving figures that claim an origin they do
    // not have — or worse, the previous import's origin.
    const patch = accountPatch(parseBalanceBlock(FIXTURE).fields, AS_OF);
    expect(patch.balances_source_type).toBe("imported_snapshot");
    expect(patch.balances_source).toBe("broker_balances_paste");
    expect(patch.balances_as_of).toBe(AS_OF.toISOString());
  });

  test("the snapshot keeps nulls as nulls and the paste verbatim", () => {
    const raw = "Total account value $128,450.00";
    const snap = toSnapshot("acct-1", parseBalanceBlock(raw), raw);
    expect(snap.account_id).toBe("acct-1");
    expect(snap.total_account_value).toBe(128_450);
    expect(snap.net_debit).toBeNull();
    // The raw text is kept so a mis-parse can be diagnosed after the fact,
    // rather than re-derived from a figure that is already wrong.
    expect(snap.raw_text).toBe(raw);
  });

  test("the snapshot carries every field the parser has", () => {
    const snap = toSnapshot("acct-1", parseBalanceBlock(FIXTURE), FIXTURE);
    // One column per parsed field, plus account_id and raw_text. A field added
    // to the parser and forgotten in the snapshot would be silently unstored.
    expect(Object.keys(snap)).toHaveLength(BALANCE_FIELD_ORDER.length + 2);
    expect(Object.values(snap).every((v) => v !== null)).toBe(true);
  });
});

// The format that actually occurs.
//
// Fidelity's balances page copies out with the label on one line and its value
// on the next, prefixed `current:`. The FIXTURE above is the reformatted
// one-line-per-field shape from the 2026-09-03 brief — a sample, not a page
// copy — and building the parser to it meant a real paste produced twelve
// misses behind a green suite. Same synthetic figures as FIXTURE, so the two
// shapes can be compared field for field.
const PAGE_COPY = `Balances
As of 09/03/2026

MARGIN STATUS
Margin interest rate
current: 9.750%
Margin interest accrued this month
current: $175.00
Net debit
current: −$20,000.00
Equity percentage
current: 86.50%
Net house surplus
current: $45,000.00

AVAILABLE TO TRADE
Margin buying power
current: $190,000.00
Non-margin buying power
current: $95,000.00
Committed to open orders
current: $7,500.00

HOLDINGS
Cash market value
current: $2,500.00
Margin market value
current: $145,950.00
Total account value
current: $128,450.00
Day change
gains/losses: +$1,234.56`;

describe("the two-line page copy — the shape that actually occurs", () => {
  const p = parseBalanceBlock(PAGE_COPY);

  test("it is not empty — the bug this replaces reported twelve misses", () => {
    expect(p.empty).toBe(false);
    expect(p.missing).toEqual([]);
  });

  test("every figure lands in its own column, across the line break", () => {
    expect(p.fields).toEqual({
      totalAccountValue: 128_450,
      dayChange: 1_234.56,
      equityPct: 86.5,
      marginBuyingPower: 190_000,
      nonMarginBuyingPower: 95_000,
      committedToOpenOrders: 7_500,
      netHouseSurplus: 45_000,
      marginInterestAccruedMtd: 175,
      marginInterestRatePct: 9.75,
      cashMarketValue: 2_500,
      marginMarketValue: 145_950,
      netDebit: 20_000,
    });
  });

  test("the debit is still stored positive, through a Unicode minus on its own line", () => {
    expect(p.fields.netDebit).toBe(20_000);
  });

  test("section headings are not reported as unrecognised", () => {
    // A warning that fires on every ordinary paste is a warning nobody reads.
    expect(p.unrecognised).toEqual([]);
  });

  test("both shapes agree field for field", () => {
    // The parser must not have learned the page copy by forgetting the sample.
    expect(parseBalanceBlock(PAGE_COPY).fields).toEqual(parseBalanceBlock(FIXTURE).fields);
  });
});

describe("the pending label is held only while it is still plausible", () => {
  test("a heading is never held, even standing before a number", () => {
    const p = parseBalanceBlock("MARGIN STATUS\n$52,300.00");
    expect(p.empty).toBe(true);
    expect(p.unrecognised).toEqual(["$52,300.00"]);
  });

  test("a heading whose WORDS match a label is still a heading", () => {
    // The one that needs the guard. `MARGIN STATUS` matches no pattern, so it
    // is dropped whether or not headings are checked — the assertion above
    // passes on a parser with no guard at all. `EQUITY` and `TOTAL` are
    // different: both match a label pattern, so without the caps check a
    // section heading would capture the first number under it and file it as
    // an equity percentage or an account total.
    const equity = parseBalanceBlock("EQUITY\n$52,300.00");
    expect(equity.fields.equityPct).toBeNull();
    expect(equity.unrecognised).toEqual(["$52,300.00"]);

    const total = parseBalanceBlock("TOTAL\n$128,450.00");
    expect(total.fields.totalAccountValue).toBeNull();
    expect(total.unrecognised).toEqual(["$128,450.00"]);
  });

  test("the same words in sentence case ARE a label", () => {
    // Proves the guard keys on capitalisation, not on the words themselves —
    // so the real page's `Equity percentage` still binds.
    const p = parseBalanceBlock("Equity percentage\ncurrent: 86.50%");
    expect(p.fields.equityPct).toBe(86.5);
  });

  test("a gains/losses line with no value clears the label rather than holding it", () => {
    // The label is real; the figure never arrived. Missing is the honest answer.
    const p = parseBalanceBlock("Day change\ngains/losses:\n$9,999.00");
    expect(p.fields.dayChange).toBeNull();
    expect(p.unrecognised).toEqual(["$9,999.00"]);
  });

  test("an unrecognised line between a label and a number breaks the pair", () => {
    const p = parseBalanceBlock("Margin interest rate\nEstimated for illustration\ncurrent: 9.750%");
    expect(p.fields.marginInterestRatePct).toBeNull();
  });

  test("a timestamp between a label and a number breaks the pair", () => {
    const p = parseBalanceBlock("Margin interest rate\nAs of 09/03/2026\ncurrent: 9.750%");
    expect(p.fields.marginInterestRatePct).toBeNull();
  });

  test("a held label does not reach past the value it is spent on", () => {
    // Two numbers under one label must not both be filed under it.
    const p = parseBalanceBlock("Cash market value\ncurrent: $2,500.00\ncurrent: $7,777.00");
    expect(p.fields.cashMarketValue).toBe(2_500);
    expect(p.unrecognised).toEqual(["current: $7,777.00"]);
  });

  test("a line carrying its own words is never bound to the held label", () => {
    // THE rule: a held label applied to the wrong value is worse than a miss.
    const p = parseBalanceBlock("Margin interest rate\nEstimated annual yield 3.20%");
    expect(p.fields.marginInterestRatePct).toBeNull();
    expect(p.unrecognised).toEqual(["Estimated annual yield 3.20%"]);
  });

  test("a one-line field resets a stale held label", () => {
    const p = parseBalanceBlock("Net house surplus\nCash market value $2,500.00\ncurrent: $6,100.00");
    expect(p.fields.cashMarketValue).toBe(2_500);
    expect(p.fields.netHouseSurplus).toBeNull();
    expect(p.unrecognised).toEqual(["current: $6,100.00"]);
  });

  test("NEGATIVE CONTROL: the adjacent pair this all exists for does bind", () => {
    // Without this, every assertion above passes on a parser that binds nothing.
    const p = parseBalanceBlock("Margin interest rate\ncurrent: 9.750%");
    expect(p.fields.marginInterestRatePct).toBe(9.75);
    expect(p.unrecognised).toEqual([]);
  });
});

describe("isSectionHeading", () => {
  test("caps headings are headings", () => {
    expect(isSectionHeading("HOLDINGS")).toBe(true);
    expect(isSectionHeading("MARGIN STATUS")).toBe(true);
    expect(isSectionHeading("AVAILABLE TO TRADE")).toBe(true);
  });

  test("a sentence-case label is not a heading", () => {
    expect(isSectionHeading("Margin interest rate")).toBe(false);
  });

  test("anything carrying digits is not a heading", () => {
    expect(isSectionHeading("TOTAL $128,450.00")).toBe(false);
  });
});

describe("isBareValue", () => {
  test("a number, with or without a prefix, is bare", () => {
    expect(isBareValue("current: 9.750%")).toBe(true);
    expect(isBareValue("gains/losses: +$1,234.56")).toBe(true);
    expect(isBareValue("−$20,000.00")).toBe(true);
    expect(isBareValue("$2,500.00")).toBe(true);
  });

  test("a single word of its own makes it not bare", () => {
    expect(isBareValue("Estimated 3.20%")).toBe(false);
    expect(isBareValue("Total account value $128,450.00")).toBe(false);
  });
});

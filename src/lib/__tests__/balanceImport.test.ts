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
  reconcile,
  toSnapshot,
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

describe("reconciliation is the point of the import", () => {
  const pasted = 128_450;

  test("agreement to the cent is a match", () => {
    const r = reconcile(pasted, 128_450);
    expect(r.kind).toBe("matches");
  });

  test("a dollar out is a difference, not a rounding tolerance", () => {
    const r = reconcile(pasted, 128_451);
    expect(r.kind).toBe("differs");
    expect(r.kind === "differs" && r.delta).toBeCloseTo(1, 2);
  });

  test("the delta says which way the app is wrong", () => {
    // Positive delta = the app thinks it has more than the broker says. That
    // usually means a stale price or a position that was sold.
    const over = reconcile(pasted, pasted + 500);
    expect(over.kind === "differs" && over.delta).toBeCloseTo(500, 2);
    const under = reconcile(pasted, pasted - 500);
    expect(under.kind === "differs" && under.delta).toBeCloseTo(-500, 2);
  });

  test("half a cent of float noise still matches", () => {
    expect(reconcile(pasted, pasted + 0.005).kind).toBe("matches");
  });

  test("no pasted total is its own state, not a match and not a difference", () => {
    // Reporting "matches" here would be an assertion made from no evidence.
    expect(reconcile(null, 128_450).kind).toBe("no-pasted-total");
  });
});

describe("what an import writes back", () => {
  test("only the columns the paste supplied", () => {
    const p = parseBalanceBlock(FIXTURE);
    expect(accountPatch(p.fields)).toEqual({
      cash: 2_500,
      margin_used: 20_000,
      buying_power: 190_000,
    });
  });

  test("a missing figure writes nothing, rather than zero over a real balance", () => {
    // This is the silent-partial-accept failure in one test: a paste with no
    // cash line must not set cash to 0.
    const p = parseBalanceBlock("Net debit −$20,000.00");
    const patch = accountPatch(p.fields);
    expect("cash" in patch).toBe(false);
    expect(patch).toEqual({ margin_used: 20_000 });
  });

  test("an all-missing paste writes nothing at all", () => {
    expect(accountPatch(parseBalanceBlock("").fields)).toEqual({});
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

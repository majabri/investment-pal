// Stage 2. The fixture is the real Fidelity balance block from 2026-09-03 —
// if the parser does not reproduce it to the cent, nothing else here matters.
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

// Amir — TOD, 2026-09-03, as it comes off the Fidelity balances page.
const FIXTURE = `Total account value $53,938.35
Day change +$1,196.68
Equity percentage 89.00%
Margin buying power $82,191.43
Non-margin buying power $24,657.43
Committed to open orders $18,209.97
Net house surplus $30,803.11
Margin interest accrued this month $91.22
Margin interest rate 11.325%
Cash market value $0.38
Margin market value $60,602.30
Net debit −$6,664.33`;

describe("the real balance block parses to the cent", () => {
  const p = parseBalanceBlock(FIXTURE);

  test("every field is found — nothing missing, nothing unrecognised", () => {
    expect(p.missing).toEqual([]);
    expect(p.unrecognised).toEqual([]);
    expect(p.empty).toBe(false);
  });

  test("each figure lands in its own column", () => {
    expect(p.fields).toEqual({
      totalAccountValue: 53_938.35,
      dayChange: 1_196.68,
      equityPct: 89,
      marginBuyingPower: 82_191.43,
      nonMarginBuyingPower: 24_657.43,
      committedToOpenOrders: 18_209.97,
      netHouseSurplus: 30_803.11,
      marginInterestAccruedMtd: 91.22,
      marginInterestRatePct: 11.325,
      cashMarketValue: 0.38,
      marginMarketValue: 60_602.3,
      netDebit: 6_664.33,
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
    for (const spelling of ["−$6,664.33", "-$6,664.33", "($6,664.33)", "$6,664.33"]) {
      const q = parseBalanceBlock(`Net debit ${spelling}`);
      expect(q.fields.netDebit).toBe(6_664.33);
    }
  });

  test("the rate is a percentage, not a fraction", () => {
    // 11.325 vs 0.11325 is a factor of 100 on a money figure. Pin it.
    expect(p.fields.marginInterestRatePct).toBe(11.325);
  });
});

describe("labels that contain one another do not swallow each other", () => {
  test("non-margin buying power is not margin buying power", () => {
    const p = parseBalanceBlock(
      "Margin buying power $82,191.43\nNon-margin buying power $24,657.43",
    );
    expect(p.fields.marginBuyingPower).toBe(82_191.43);
    expect(p.fields.nonMarginBuyingPower).toBe(24_657.43);
  });

  test("order in the paste does not decide which is which", () => {
    // The reversed paste must produce the identical mapping. If it does not,
    // the parser is matching on position rather than on the label.
    const p = parseBalanceBlock(
      "Non-margin buying power $24,657.43\nMargin buying power $82,191.43",
    );
    expect(p.fields.marginBuyingPower).toBe(82_191.43);
    expect(p.fields.nonMarginBuyingPower).toBe(24_657.43);
  });

  test("margin market value is not the margin interest rate", () => {
    const p = parseBalanceBlock("Margin market value $60,602.30\nMargin interest rate 11.325%");
    expect(p.fields.marginMarketValue).toBe(60_602.3);
    expect(p.fields.marginInterestRatePct).toBe(11.325);
  });

  test("accrued interest is not the rate", () => {
    const p = parseBalanceBlock(
      "Margin interest accrued this month $91.22\nMargin interest rate 11.325%",
    );
    expect(p.fields.marginInterestAccruedMtd).toBe(91.22);
    expect(p.fields.marginInterestRatePct).toBe(11.325);
  });
});

describe("a partial paste is reported, never completed", () => {
  test("what is missing is named, and the rest still parses", () => {
    const p = parseBalanceBlock("Total account value $53,938.35\nCash market value $0.38");
    expect(p.fields.totalAccountValue).toBe(53_938.35);
    expect(p.fields.netDebit).toBeNull();
    expect(p.missing).toContain("netDebit");
    expect(p.missing).toContain("marginBuyingPower");
  });

  test("a missing figure is null, not zero", () => {
    // Zero is a claim: "this account has no margin loan". Null is the truth:
    // "the paste did not say". They must not be the same value.
    const p = parseBalanceBlock("Total account value $53,938.35");
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
    const p = parseBalanceBlock("Balances\nAs of 09/03/2026\nTotal account value $53,938.35");
    expect(p.fields.totalAccountValue).toBe(53_938.35);
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
      const p = parseBalanceBlock(`${stamp}\nTotal account value $53,938.35`);
      expect(p.unrecognised).toEqual([]);
      expect(p.fields.totalAccountValue).toBe(53_938.35);
    }
  });

  test("a timestamp alone is an empty parse, not a figure of 9", () => {
    expect(parseBalanceBlock("As of 09/03/2026").empty).toBe(true);
  });
});

describe("paste shapes", () => {
  test("the same block parses identically from lines, dots and pipes", () => {
    const lines = "Total account value $53,938.35\nCash market value $0.38";
    const dots = "Total account value $53,938.35 · Cash market value $0.38";
    const pipes = "Total account value $53,938.35 | Cash market value $0.38";
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
    expect(isDateOrTime("Total account value $53,938.35")).toBe(false);
    expect(isDateOrTime("Margin interest rate 11.325%")).toBe(false);
    expect(isDateOrTime("Net debit −$6,664.33")).toBe(false);
  });
});

describe("parseAmount", () => {
  test("reads dollars, percentages and plain numbers", () => {
    expect(parseAmount("$53,938.35")).toBe(53_938.35);
    expect(parseAmount("89.00%")).toBe(89);
    expect(parseAmount("1196.68")).toBe(1_196.68);
  });

  test("all three negative spellings are negative", () => {
    expect(parseAmount("-$6,664.33")).toBe(-6_664.33);
    expect(parseAmount("−$6,664.33")).toBe(-6_664.33); // U+2212, what the site emits
    expect(parseAmount("($6,664.33)")).toBe(-6_664.33);
  });

  test("a leading plus is positive, not dropped into a negative", () => {
    expect(parseAmount("+$1,196.68")).toBe(1_196.68);
  });

  test("text with no number is null, not zero", () => {
    expect(parseAmount("Total account value")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});

describe("reconciliation is the point of the import", () => {
  const pasted = 53_938.35;

  test("agreement to the cent is a match", () => {
    const r = reconcile(pasted, 53_938.35);
    expect(r.kind).toBe("matches");
  });

  test("a dollar out is a difference, not a rounding tolerance", () => {
    const r = reconcile(pasted, 53_939.35);
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
    expect(reconcile(null, 53_938.35).kind).toBe("no-pasted-total");
  });
});

describe("what an import writes back", () => {
  test("only the columns the paste supplied", () => {
    const p = parseBalanceBlock(FIXTURE);
    expect(accountPatch(p.fields)).toEqual({
      cash: 0.38,
      margin_used: 6_664.33,
      buying_power: 82_191.43,
    });
  });

  test("a missing figure writes nothing, rather than zero over a real balance", () => {
    // This is the silent-partial-accept failure in one test: a paste with no
    // cash line must not set cash to 0.
    const p = parseBalanceBlock("Net debit −$6,664.33");
    const patch = accountPatch(p.fields);
    expect("cash" in patch).toBe(false);
    expect(patch).toEqual({ margin_used: 6_664.33 });
  });

  test("an all-missing paste writes nothing at all", () => {
    expect(accountPatch(parseBalanceBlock("").fields)).toEqual({});
  });

  test("the snapshot keeps nulls as nulls and the paste verbatim", () => {
    const raw = "Total account value $53,938.35";
    const snap = toSnapshot("acct-1", parseBalanceBlock(raw), raw);
    expect(snap.account_id).toBe("acct-1");
    expect(snap.total_account_value).toBe(53_938.35);
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

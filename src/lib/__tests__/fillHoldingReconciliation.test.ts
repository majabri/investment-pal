// Fills against holdings (ADR-APP-016; §26.2 test 8; ACC-4).
import { describe, expect, test } from "bun:test";

import {
  NON_HOLDING_STATUSES,
  exclusionsNote,
  holdingDeltas,
  inWindow,
  reconcileFillsToHoldings,
  reconciliationHeadline,
  signedQuantity,
  symbolSentence,
} from "@/lib/fillHoldingReconciliation";
import type { FillWithOrder, HoldingAuditRow, ImportWindow } from "@/lib/fillHoldingReconciliation";

const W: ImportWindow = { batchId: "b2", startedAt: "2026-09-18T20:00:00Z", finishedAt: "2026-09-18T20:00:05Z", priorFinishedAt: "2026-09-17T20:00:05Z" };
const fill = (symbol: string, side: string, quantity: number, over: Partial<FillWithOrder> = {}): FillWithOrder => ({
  symbol, side, quantity, orderStatus: "filled", filledAt: "2026-09-18T15:00:00Z", ...over,
});
const upd = (symbol: string, before: number, after: number, at = "2026-09-18T20:00:02Z"): HoldingAuditRow => ({ symbol, before, after, changedAt: at });

describe("signedQuantity", () => {
  test("buys add, sales subtract, an unknown side is null", () => {
    expect(signedQuantity("buy", 5)).toBe(5);
    expect(signedQuantity("buy_to_cover", 5)).toBe(5);
    expect(signedQuantity("sell", 5)).toBe(-5);
    expect(signedQuantity("sell_short", 5)).toBe(-5);
    expect(signedQuantity("transfer", 5)).toBeNull();
    expect(signedQuantity("buy", 0)).toBeNull();
    expect(signedQuantity("buy", NaN)).toBeNull();
  });
});

describe("inWindow", () => {
  test("(prior, finished] — the prior import's own instant is excluded, this one's included", () => {
    expect(inWindow("2026-09-17T20:00:05Z", W)).toBe(false);
    expect(inWindow("2026-09-17T20:00:06Z", W)).toBe(true);
    expect(inWindow("2026-09-18T20:00:05Z", W)).toBe(true);
    expect(inWindow("2026-09-18T20:00:06Z", W)).toBe(false);
    expect(inWindow("garbage", W)).toBe(false);
  });
  test("a first import has no lower bound", () => {
    expect(inWindow("2020-01-01T00:00:00Z", { ...W, priorFinishedAt: null })).toBe(true);
  });
});

describe("holdingDeltas", () => {
  test("earliest before to latest after, per symbol; INSERT from 0, DELETE to 0", () => {
    const d = holdingDeltas([
      upd("SYMA", 10, 12, "2026-09-18T20:00:01Z"),
      upd("SYMA", 12, 15, "2026-09-18T20:00:03Z"),
      { symbol: "SYMN", before: null, after: 4, changedAt: "2026-09-18T20:00:02Z" },
      { symbol: "SYMG", before: 7, after: null, changedAt: "2026-09-18T20:00:02Z" },
    ]);
    expect(d.get("SYMA")).toBe(5);
    expect(d.get("SYMN")).toBe(4);
    expect(d.get("SYMG")).toBe(-7);
  });
});

describe("reconcileFillsToHoldings", () => {
  test("no committed import: nothing to compare against, said as such", () => {
    expect(reconcileFillsToHoldings({ window: null, audit: [], fills: [fill("SYMA", "buy", 1)] })).toEqual({ status: "no_import" });
  });
  test("an unreadable audit trail is not an empty one", () => {
    const r = reconcileFillsToHoldings({ window: W, audit: null, fills: [] });
    expect(r.status).toBe("no_audit");
  });
  test("fills that match the import's change are explained", () => {
    const r = reconcileFillsToHoldings({ window: W, audit: [upd("SYMA", 10, 15)], fills: [fill("SYMA", "buy", 3), fill("SYMA", "buy", 2)] });
    expect(r.status).toBe("compared");
    if (r.status === "compared") {
      expect(r.lines).toEqual([{ symbol: "SYMA", expected: 5, observed: 5, fillCount: 2, verdict: "explained" }]);
    }
  });
  test("fills the import did not reflect are flagged, not applied", () => {
    const r = reconcileFillsToHoldings({ window: W, audit: [], fills: [fill("SYMA", "buy", 3)] });
    if (r.status === "compared") {
      expect(r.lines[0]).toEqual({ symbol: "SYMA", expected: 3, observed: 0, fillCount: 1, verdict: "fills_not_reflected" });
    }
    const partial = reconcileFillsToHoldings({ window: W, audit: [upd("SYMA", 10, 11)], fills: [fill("SYMA", "buy", 3)] });
    if (partial.status === "compared") expect(partial.lines[0]!.verdict).toBe("fills_not_reflected");
  });
  test("a change no fill explains is flagged", () => {
    const r = reconcileFillsToHoldings({ window: W, audit: [upd("SYMB", 10, 4)], fills: [] });
    if (r.status === "compared") {
      expect(r.lines).toEqual([{ symbol: "SYMB", expected: 0, observed: -6, fillCount: 0, verdict: "change_unexplained" }]);
    }
  });
  test("§26.2 test 8: fills on cancelled, untriggered, superseded, rejected or expired orders never count toward a holding", () => {
    expect([...NON_HOLDING_STATUSES]).toEqual(["cancelled", "untriggered", "superseded", "rejected", "expired"]);
    const fills = NON_HOLDING_STATUSES.map((s) => fill("SYMA", "buy", 10, { orderStatus: s }));
    const r = reconcileFillsToHoldings({ window: W, audit: [], fills });
    expect(r.status).toBe("compared");
    if (r.status === "compared") {
      expect(r.lines).toEqual([]); // no expectation was formed, so no line
      expect(r.excludedFills).toBe(5);
    }
    // Negative control: the same fill on a filled order does form an expectation.
    const live = reconcileFillsToHoldings({ window: W, audit: [], fills: [fill("SYMA", "buy", 10)] });
    if (live.status === "compared") expect(live.lines.length).toBe(1);
  });
  test("fills outside the window are not this import's to explain, and are counted", () => {
    const r = reconcileFillsToHoldings({ window: W, audit: [], fills: [fill("SYMA", "buy", 1, { filledAt: "2026-09-10T00:00:00Z" })] });
    if (r.status === "compared") {
      expect(r.lines).toEqual([]);
      expect(r.outsideWindow).toBe(1);
    }
  });
  test("an unknown side makes the expectation unknown, never zero", () => {
    const r = reconcileFillsToHoldings({ window: W, audit: [upd("SYMA", 10, 12)], fills: [fill("SYMA", "transfer", 2)] });
    if (r.status === "compared") {
      expect(r.lines[0]).toEqual({ symbol: "SYMA", expected: null, observed: 2, fillCount: 1, verdict: "side_unknown" });
    }
  });
  test("sells subtract; a trim explained by the import agrees", () => {
    const r = reconcileFillsToHoldings({ window: W, audit: [upd("SYMA", 10, 7)], fills: [fill("SYMA", "sell", 3)] });
    if (r.status === "compared") expect(r.lines[0]!.verdict).toBe("explained");
  });
});

describe("the sentences", () => {
  test("the headline says what was compared, or why nothing was", () => {
    expect(reconciliationHeadline({ status: "no_import" })).toContain("No committed import");
    expect(reconciliationHeadline({ status: "no_audit", window: W })).toContain("no readable audit trail");
    const all = reconcileFillsToHoldings({ window: W, audit: [upd("SYMA", 10, 15)], fills: [fill("SYMA", "buy", 5)] });
    expect(reconciliationHeadline(all)).toContain("all 1 symbol agrees");
    const flagged = reconcileFillsToHoldings({ window: W, audit: [upd("SYMA", 10, 15)], fills: [fill("SYMB", "buy", 5)] });
    expect(reconciliationHeadline(flagged)).toContain("2 of 2 symbols flagged");
    expect(reconciliationHeadline(flagged)).toContain("Nothing was applied");
    const empty = reconcileFillsToHoldings({ window: W, audit: [], fills: [] });
    expect(reconciliationHeadline(empty)).toContain("no fills and no holding changes");
    // Negative control: a flagged result never says "agree".
    expect(reconciliationHeadline(flagged)).not.toContain("agree");
  });
  test("each verdict has its own sentence with the figures", () => {
    expect(symbolSentence({ symbol: "SYMA", expected: 5, observed: 5, fillCount: 2, verdict: "explained" })).toBe("SYMA: 2 fills (+5) match the import's change (+5).");
    expect(symbolSentence({ symbol: "SYMA", expected: 3, observed: 0, fillCount: 1, verdict: "fills_not_reflected" })).toContain("Not applied");
    expect(symbolSentence({ symbol: "SYMB", expected: 0, observed: -6, fillCount: 0, verdict: "change_unexplained" })).toContain("no recorded fill explains it");
    expect(symbolSentence({ symbol: "SYMA", expected: null, observed: 2, fillCount: 1, verdict: "side_unknown" })).toContain("cannot be summed");
  });
  test("the exclusions note appears only when something was left out", () => {
    expect(exclusionsNote(reconcileFillsToHoldings({ window: W, audit: [], fills: [] }))).toBeNull();
    const r = reconcileFillsToHoldings({ window: W, audit: [], fills: [fill("SYMA", "buy", 1, { orderStatus: "cancelled" }), fill("SYMA", "buy", 1, { filledAt: "2020-01-01T00:00:00Z" })] });
    expect(exclusionsNote(r)).toBe("Left out: 1 fill on cancelled, untriggered, superseded, rejected or expired orders — never counted toward a holding; 1 fill outside this import's window.");
    expect(exclusionsNote({ status: "no_import" })).toBeNull();
  });
});

// Brokerage Service abstraction (constitution: v1 = manual CSV; future
// read-only sync must plug in without redesign). Trading is never automated.
import { parsePositionsCsv, type ParseResult } from "./csvImport";

export interface NormalizedPosition {
  accountLabel: string;
  symbol: string;
  quantity: number;
  avgCostPerShare: number;
  lastPrice: number;
  currentValue?: number;
}

export interface BrokerageImportResult {
  positions: NormalizedPosition[];
  cashByAccount: Record<string, number>;
  skippedCount: number;
}

export interface BrokerageService {
  readonly name: string;
  /** Parse raw exported data (CSV text) into normalized positions. */
  parseExport(raw: string): BrokerageImportResult;
}

export class FidelityCsvBrokerage implements BrokerageService {
  readonly name = "Fidelity (CSV export)";
  parseExport(raw: string): BrokerageImportResult {
    const r: ParseResult = parsePositionsCsv(raw);
    return {
      positions: r.rows.map((h) => ({
        accountLabel: h.accountName ?? "Unlabeled account",
        symbol: h.symbol,
        quantity: h.quantity,
        avgCostPerShare: h.cost_basis,
        lastPrice: h.current_price,
        currentValue: h.currentValue,
      })),
      cashByAccount: r.cashByAccount,
      skippedCount: r.skipped.length,
    };
  }
}

/** Registry: future brokers (Schwab CSV, Fidelity read-only API) register here. */
export const brokerages: BrokerageService[] = [new FidelityCsvBrokerage()];

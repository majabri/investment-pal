// Tolerant CSV parser for brokerage position exports.
// Supports Fidelity's "Positions" export (with headers) plus a simple
// symbol,qty,cost,price[,sector] positional format.

export type ParsedHolding = {
  symbol: string;
  quantity: number;
  cost_basis: number; // per-share
  current_price: number;
  sector: string | null;
  accountName?: string; // from "Account Name" column when present
  currentValue?: number; // from "Current Value" column when present
};

export type ParseResult = {
  rows: ParsedHolding[];
  skipped: { line: string; reason: string }[];
  /** Money-market/core cash per Fidelity account label (e.g. SPAXX**). */
  cashByAccount: Record<string, number>;
};

// Split a CSV line respecting quoted fields.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim().replace(/^"|"$/g, ""));
}

function toNumber(v: string | undefined): number {
  if (v == null) return 0;
  const cleaned = v.replace(/[$,%\s]/g, "").replace(/^\((.+)\)$/, "-$1");
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

const HEADER_ALIASES: Record<string, string[]> = {
  symbol: ["symbol", "ticker"],
  description: ["description", "security description", "name"],
  quantity: ["quantity", "shares", "qty"],
  price: ["last price", "price", "current price", "market price"],
  value: ["current value", "market value", "value"],
  cost_total: ["cost basis total", "total cost basis", "cost basis"],
  cost_avg: ["average cost basis", "avg cost", "average cost", "cost basis per share"],
  type: ["type", "security type"],
};

function findIdx(headers: string[], key: keyof typeof HEADER_ALIASES): number {
  const aliases = HEADER_ALIASES[key];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim();
    if (aliases.some((a) => h === a)) return i;
  }
  return -1;
}

export function parsePositionsCsv(input: string): ParseResult {
  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows: ParsedHolding[] = [];
  const skipped: { line: string; reason: string }[] = [];
  const cashByAccount: Record<string, number> = {};
  if (!lines.length) return { rows, skipped, cashByAccount };

  const firstCells = splitCsvLine(lines[0]).map((c) => c.toLowerCase());
  const hasHeader = firstCells.some((c) => c.includes("symbol") || c.includes("ticker"));

  if (hasHeader) {
    const headers = splitCsvLine(lines[0]);
    const iSym = findIdx(headers, "symbol");
    const iQty = findIdx(headers, "quantity");
    const iPx = findIdx(headers, "price");
    const iVal = findIdx(headers, "value");
    const iCostTot = findIdx(headers, "cost_total");
    const iAcct = headers.findIndex((h) => h.toLowerCase().includes("account name"));
    const iCostAvg = findIdx(headers, "cost_avg");
    const iType = findIdx(headers, "type");
    if (iSym < 0) {
      skipped.push({ line: lines[0], reason: "No Symbol column found" });
      return { rows, skipped, cashByAccount };
    }
    for (let li = 1; li < lines.length; li++) {
      const raw = lines[li];
      const cells = splitCsvLine(raw);
      const sym = (cells[iSym] || "").toUpperCase().trim();
      const acctLabel =
        iAcct >= 0 ? cells[iAcct]?.trim() || "Unlabeled account" : "Unlabeled account";
      const desc = (cells[findIdx(headers, "description")] ?? "").toUpperCase();
      // Money market / core position → account cash, not a holding
      if (
        sym.includes("**") ||
        desc.includes("MONEY MARKET") ||
        sym === "SPAXX" ||
        sym === "FCASH" ||
        sym === "FDRXX"
      ) {
        const v = iVal >= 0 ? toNumber(cells[iVal]) : 0;
        cashByAccount[acctLabel] = (cashByAccount[acctLabel] ?? 0) + v;
        skipped.push({ line: raw, reason: "Core cash → account cash" });
        continue;
      }
      if (!sym || sym.startsWith("PENDING")) {
        skipped.push({ line: raw, reason: "No symbol / pending activity" });
        continue;
      }
      // NOTE: Fidelity's "Type" column is the account registration (Cash/Margin),
      // NOT the security type — never skip on it.
      const qty = iQty >= 0 ? toNumber(cells[iQty]) : 0;
      const price =
        iPx >= 0 ? toNumber(cells[iPx]) : iVal >= 0 && qty ? toNumber(cells[iVal]) / qty : 0;
      let costPer = iCostAvg >= 0 ? toNumber(cells[iCostAvg]) : 0;
      if (!costPer && iCostTot >= 0 && qty) {
        costPer = toNumber(cells[iCostTot]) / qty;
      }
      if (!qty && !price) {
        skipped.push({ line: raw, reason: "Missing quantity and price" });
        continue;
      }
      rows.push({
        symbol: sym,
        quantity: qty,
        cost_basis: costPer,
        current_price: price,
        sector: null,
        accountName: iAcct >= 0 ? cells[iAcct]?.trim() : undefined,
        currentValue: iVal >= 0 ? toNumber(cells[iVal]) : undefined,
      });
    }
  } else {
    // Positional: symbol,qty,cost,price[,sector]
    for (const raw of lines) {
      const cells = splitCsvLine(raw);
      const [symbol, qty, cost, price, sector] = cells;
      const sym = (symbol || "").toUpperCase().trim();
      if (!sym) {
        skipped.push({ line: raw, reason: "Missing symbol" });
        continue;
      }
      rows.push({
        symbol: sym,
        quantity: toNumber(qty),
        cost_basis: toNumber(cost),
        current_price: toNumber(price),
        sector: sector || null,
      });
    }
  }
  return { rows, skipped, cashByAccount };
}

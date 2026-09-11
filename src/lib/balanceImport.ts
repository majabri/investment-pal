// Fidelity balance-block parser.
//
// Stage 2 of the 2026-09-03 brief. Positions already import from a CSV; the
// balances beside them — total account value, the margin debit, buying power,
// accrued interest, the rate — were typed in by hand into four number boxes on
// the Portfolio screen. Hand-typed money goes stale silently and disagrees with
// the broker without anything noticing.
//
// Two rules shape this file:
//
//   1. A partial parse is never silently accepted. Every field is optional in
//      the paste and explicitly reported as present or missing. A block that
//      yields three of twelve fields is a *result*, not an error, but the
//      caller and the screen both see exactly which three.
//   2. Nothing is invented. There is no default, no "assume zero", and no
//      carrying a value over from a previous import. Absent is absent (null),
//      which is a different fact from zero and is displayed differently
//      (AIOS §27 — never invent broker states).
//
// Pure and free of React and Supabase so the arithmetic and the label matching
// are testable against a real statement without a database.

/** Every figure the balance block can carry. `null` means it was not in the paste. */
export type BalanceFields = {
  /** Fidelity's "Total account value" — the net figure, after the debit. */
  totalAccountValue: number | null;
  /** Change since the previous close, signed. */
  dayChange: number | null;
  /** Equity as a percentage (89 for 89.00%), not a fraction. */
  equityPct: number | null;
  marginBuyingPower: number | null;
  nonMarginBuyingPower: number | null;
  committedToOpenOrders: number | null;
  netHouseSurplus: number | null;
  /** Interest the broker has actually accrued this month. An observed fact. */
  marginInterestAccruedMtd: number | null;
  /** Annual rate as a percentage (9.750 for 9.75%), not a fraction. */
  marginInterestRatePct: number | null;
  cashMarketValue: number | null;
  marginMarketValue: number | null;
  /**
   * The margin debit, stored as a POSITIVE magnitude.
   *
   * Fidelity prints it as a negative ("−$20,000.00"). `accounts.margin_used` and
   * `accountTotals` both hold it positive and subtract it. Normalising the sign
   * here, once, is why the rest of the app cannot get the direction wrong — a
   * sign error on a debit is silent and the size of the whole loan.
   */
  netDebit: number | null;
};

export type BalanceFieldKey = keyof BalanceFields;

/** Field order for display. Deliberately the order Fidelity prints them in. */
export const BALANCE_FIELD_ORDER: BalanceFieldKey[] = [
  "totalAccountValue",
  "dayChange",
  "equityPct",
  "marginBuyingPower",
  "nonMarginBuyingPower",
  "committedToOpenOrders",
  "netHouseSurplus",
  "marginInterestAccruedMtd",
  "marginInterestRatePct",
  "cashMarketValue",
  "marginMarketValue",
  "netDebit",
];

export const BALANCE_FIELD_LABELS: Record<BalanceFieldKey, string> = {
  totalAccountValue: "Total account value",
  dayChange: "Day change",
  equityPct: "Equity percentage",
  marginBuyingPower: "Margin buying power",
  nonMarginBuyingPower: "Non-margin buying power",
  committedToOpenOrders: "Committed to open orders",
  netHouseSurplus: "Net house surplus",
  marginInterestAccruedMtd: "Margin interest accrued this month",
  marginInterestRatePct: "Margin interest rate",
  cashMarketValue: "Cash market value",
  marginMarketValue: "Margin market value",
  netDebit: "Net debit (margin loan)",
};

/**
 * Label patterns, most specific first.
 *
 * Order matters: "margin buying power" must be tried before "buying power",
 * and "non-margin" before "margin", or the shorter pattern swallows the longer
 * one and the wrong figure lands in the wrong column — the kind of mistake that
 * is invisible on screen because both are plausible dollar amounts.
 */
const LABEL_PATTERNS: [BalanceFieldKey, RegExp][] = [
  [
    "marginInterestAccruedMtd",
    /margin\s+interest\s+(accrued|charged)(\s+this\s+month|\s+mtd|\s+month\s+to\s+date)?/i,
  ],
  ["marginInterestRatePct", /margin\s+interest\s+rate|margin\s+rate|interest\s+rate/i],
  ["nonMarginBuyingPower", /non[\s-]*margin(\s+buying\s+power)?/i],
  ["marginBuyingPower", /margin\s+buying\s+power/i],
  ["committedToOpenOrders", /committed\s+to\s+open\s+orders|committed\s+to\s+orders/i],
  ["netHouseSurplus", /net\s+house\s+surplus|house\s+surplus/i],
  ["cashMarketValue", /cash\s+market\s+value|cash\s+\(core\)|core\s+cash/i],
  ["marginMarketValue", /margin\s+market\s+value/i],
  ["netDebit", /net\s+debit|margin\s+debit|debit\s+balance|margin\s+loan/i],
  ["equityPct", /equity\s*(percent(age)?|%)?/i],
  [
    "dayChange",
    /day(?:'s)?\s+(change|gain\/loss|gain or loss)|today(?:'s)?\s+change|change\s+since\s+(previous\s+)?close/i,
  ],
  ["totalAccountValue", /total\s+account\s+value|account\s+value|^\s*total\s*$/i],
];

export type BalanceParse = {
  fields: BalanceFields;
  /** Fields the paste did not supply. Never filled in, only reported. */
  missing: BalanceFieldKey[];
  /**
   * Lines that carried a number but matched no known label.
   *
   * Surfaced rather than dropped: an unrecognised line is usually a field
   * Fidelity renamed, and swallowing it turns a rename into a value that
   * quietly stops updating.
   */
  unrecognised: string[];
  /** True when the paste yielded no field at all — not a balance block. */
  empty: boolean;
};

const EMPTY_FIELDS = (): BalanceFields => ({
  totalAccountValue: null,
  dayChange: null,
  equityPct: null,
  marginBuyingPower: null,
  nonMarginBuyingPower: null,
  committedToOpenOrders: null,
  netHouseSurplus: null,
  marginInterestAccruedMtd: null,
  marginInterestRatePct: null,
  cashMarketValue: null,
  marginMarketValue: null,
  netDebit: null,
});

/**
 * The first money/percentage figure in a fragment, signed.
 *
 * Handles Fidelity's three ways of writing a negative — a leading minus, a
 * Unicode minus (U+2212, which is what actually comes off the web page), and
 * accounting parentheses — because getting any of them wrong flips a debit into
 * a credit.
 */
const AMOUNT = /\(?\s*[−–—-]?\s*\$?\s*[\d,]+(?:\.\d+)?\s*%?\s*\)?/;

export function parseAmount(text: string): number | null {
  const m = text.match(AMOUNT);
  if (!m) return null;
  const raw = m[0];
  const negative = /^\s*\(/.test(raw) || /[−–—-]\s*\$?\s*[\d,]/.test(raw);
  const digits = raw.replace(/[^\d.]/g, "");
  if (digits === "" || digits === ".") return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Dates, times and "as of" stamps.
 *
 * These carry digits, so `parseAmount` reads one out of them ("09" from
 * 09/03/2026). Without this they would be reported as unrecognised lines, and a
 * warning that fires on every ordinary paste is a warning the user learns to
 * scroll past — which is how the real unrecognised line, the renamed field,
 * gets missed.
 */
const DATE_OR_TIME =
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\s*(am|pm|et|ct|pt)?\b/i;

/** True for a fragment that is a timestamp rather than a figure. */
export function isDateOrTime(fragment: string): boolean {
  return DATE_OR_TIME.test(fragment);
}

/**
 * Prefixes Fidelity puts on a VALUE line when the label is on the line above.
 *
 * The balances page copies out as two lines per field — `Margin interest rate`
 * then `current: 9.875%` — and the prefix is the only thing standing between
 * the label above and its number. Stripped rather than matched as a label,
 * because `current:` names no field.
 */
const VALUE_PREFIX = /^\s*(?:current|gains?\/losses?|gain\/loss)\s*:\s*/i;

/**
 * A section heading: capitals, no lowercase, no digits.
 *
 * `HOLDINGS`, `MARGIN STATUS`, `AVAILABLE TO TRADE`. These must never be held
 * as a pending label — a heading held across a section boundary is exactly the
 * wrong-value binding this parser refuses to make.
 */
export function isSectionHeading(fragment: string): boolean {
  return /[A-Z]/.test(fragment) && !/[a-z]/.test(fragment) && !/\d/.test(fragment);
}

/** The field a fragment's text names, or null. */
function labelKeyOf(text: string): BalanceFieldKey | null {
  const hit = LABEL_PATTERNS.find(([, re]) => re.test(text));
  return hit ? hit[0] : null;
}

/**
 * Whether a fragment is a number and nothing else.
 *
 * This is the guard on the whole pending-label mechanism. A held label may be
 * applied ONLY to a fragment that carries no words of its own: once the amount
 * and any `current:` prefix are removed, a single letter left behind means the
 * line names something, and binding the held label to it would file a figure
 * under a field the user never saw. A miss is recoverable; a wrong number in a
 * balance column is not (rule 1 — a partial parse is never silently accepted).
 */
export function isBareValue(fragment: string): boolean {
  const rest = fragment.replace(VALUE_PREFIX, "").replace(AMOUNT, " ");
  return !/[A-Za-z]/.test(rest);
}

/**
 * Split a paste into label/value fragments.
 *
 * Fidelity's balances copy out as one line per field on the web, as
 * tab-separated pairs from a spreadsheet, and as a single dot-joined run when
 * pasted through a chat client. All three are the same data, so all three are
 * accepted rather than making the user reformat money by hand.
 */
export function balanceFragments(input: string): string[] {
  return input
    .split(/[\n\r]+|\s+·\s+|\s+•\s+|\s+\|\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse a pasted Fidelity balance block. Never throws; reports what it found. */
export function parseBalanceBlock(input: string): BalanceParse {
  const fields = EMPTY_FIELDS();
  const unrecognised: string[] = [];

  // The label from a preceding line, waiting for the number that belongs to it.
  //
  // Fidelity's balances page copies out with the label and its value on
  // SEPARATE lines. Before this, a label line was dropped as "a heading" and
  // the value line landed in `unrecognised`, so a real paste produced twelve
  // misses and the screen said "No balance figures found in that text" — while
  // the test suite stayed green, because every fixture used the reformatted
  // one-line shape from the 2026-09-03 brief rather than the page copy.
  //
  // The label is held for exactly one fragment's reach and is dropped by
  // anything that breaks the adjacency it assumes.
  let held: BalanceFieldKey | null = null;

  const take = (key: BalanceFieldKey, amount: number) => {
    // First occurrence wins. Fidelity repeats "Total" in per-section subtotals
    // below the summary; the summary comes first and is the one that is the
    // account's total.
    if (fields[key] !== null) return;
    // The debit is stored positive whichever way it was printed.
    fields[key] = key === "netDebit" ? Math.abs(amount) : amount;
  };

  for (const fragment of balanceFragments(input)) {
    // A timestamp is not a figure. Skipped before parsing, because the digits
    // in a date parse perfectly well into a plausible-looking amount. It also
    // drops any held label: a stamp between a label and a number means they
    // were never a pair.
    if (isDateOrTime(fragment)) {
      held = null;
      continue;
    }

    const amount = parseAmount(fragment);

    if (amount === null) {
      // No number. Either a label awaiting its value on the next line, or a
      // heading/disclaimer — including a `gains/losses:` line with nothing
      // after it, which names a field but supplies no figure.
      //
      // A heading is never held even when its words brush a label pattern, and
      // an unrecognised line CLEARS the held label rather than leaving it to
      // reach across. Both are the same rule: the pending label survives only
      // while the next line is still plausibly its value.
      held = isSectionHeading(fragment) ? null : labelKeyOf(fragment);
      continue;
    }

    // Match against the label part only. Searching the whole fragment lets a
    // dollar amount containing "11" satisfy a pattern meant for a label.
    const label = fragment.slice(0, fragment.search(AMOUNT));
    const own = labelKeyOf(label || fragment);
    if (own) {
      // Label and value on one line — the original single-line shape. It
      // answers for itself, so any held label is stale and goes.
      take(own, amount);
      held = null;
      continue;
    }

    if (held !== null && isBareValue(fragment)) {
      take(held, amount);
      held = null;
      continue;
    }

    // A number under no label this parser knows. Reported, never guessed at:
    // applying a held label to a line carrying words of its own is how a figure
    // lands in the wrong column, which is worse than the miss.
    unrecognised.push(fragment);
    held = null;
  }

  const missing = BALANCE_FIELD_ORDER.filter((k) => fields[k] === null);
  return {
    fields,
    missing,
    unrecognised,
    empty: missing.length === BALANCE_FIELD_ORDER.length,
  };
}

/**
 * The row written to `account_balances`.
 *
 * One row per account per import, never an update in place: the history is the
 * point. A balance overwritten is a balance that cannot be reconciled against
 * later, and the day change / accrued interest series only exists if the rows
 * accumulate.
 */
export type BalanceSnapshotInsert = {
  account_id: string;
  total_account_value: number | null;
  day_change: number | null;
  equity_pct: number | null;
  margin_buying_power: number | null;
  non_margin_buying_power: number | null;
  committed_to_open_orders: number | null;
  net_house_surplus: number | null;
  margin_interest_accrued_mtd: number | null;
  margin_interest_rate_pct: number | null;
  cash_market_value: number | null;
  margin_market_value: number | null;
  net_debit: number | null;
  /** The paste, verbatim, so a mis-parse can be diagnosed after the fact. */
  raw_text: string;
};

/** Map parsed fields onto the snapshot row. Nulls stay null — never coerced. */
export function toSnapshot(
  accountId: string,
  parse: BalanceParse,
  rawText: string,
): BalanceSnapshotInsert {
  const f = parse.fields;
  return {
    account_id: accountId,
    total_account_value: f.totalAccountValue,
    day_change: f.dayChange,
    equity_pct: f.equityPct,
    margin_buying_power: f.marginBuyingPower,
    non_margin_buying_power: f.nonMarginBuyingPower,
    committed_to_open_orders: f.committedToOpenOrders,
    net_house_surplus: f.netHouseSurplus,
    margin_interest_accrued_mtd: f.marginInterestAccruedMtd,
    margin_interest_rate_pct: f.marginInterestRatePct,
    cash_market_value: f.cashMarketValue,
    margin_market_value: f.marginMarketValue,
    net_debit: f.netDebit,
    raw_text: rawText,
  };
}

/**
 * The patch an import applies to `accounts`, from the fields it actually got.
 *
 * Only the columns the paste supplied. A missing `cash market value` must not
 * write 0 over a real cash balance — that is the silent-partial-accept failure
 * this stage exists to prevent, and it costs exactly as much as it sounds.
 */
export function accountPatch(
  fields: BalanceFields,
  /** When the figures were true. Defaults to now — a paste captures the page as
   *  it stood, and the import UI has nothing better to offer. */
  asOf: Date = new Date(),
): Record<string, number | string> {
  const patch: Record<string, number | string> = {};
  if (fields.cashMarketValue !== null) patch.cash = fields.cashMarketValue;
  if (fields.netDebit !== null) patch.margin_used = fields.netDebit;
  if (fields.marginBuyingPower !== null) patch.buying_power = fields.marginBuyingPower;
  // Provenance travels WITH the figures, in the same patch (Phase 1d, rule 14).
  // Writing it separately would let one succeed and the other fail, leaving
  // figures that claim an origin they do not have — or worse, an origin that
  // belongs to the previous import.
  if (Object.keys(patch).length > 0) {
    patch.balances_source_type = "imported_snapshot";
    patch.balances_source = "broker_balances_paste";
    patch.balances_as_of = asOf.toISOString();
  }
  return patch;
}

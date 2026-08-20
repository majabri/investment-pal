// Renders a holding's Swing Score (ADR-APP-002). Advisory only — the number and
// any trim hint inform the committee; they never size or place an order.
import type { SwingResult } from "@/lib/swingScore";

const BAND_CLASS: Record<SwingResult["band"], string> = {
  none: "text-muted-foreground",
  "trim-partial": "text-amber-600 dark:text-amber-500 font-medium",
  "trim-large": "text-destructive font-semibold",
  "earnings-hold": "text-blue-600 dark:text-blue-400",
};

export function SwingScoreBadge({ r }: { r: SwingResult }) {
  if (r.insufficient || r.score == null) {
    return (
      <span
        className="text-muted-foreground"
        title="Insufficient price history (need ~50 daily closes)"
      >
        —
      </span>
    );
  }
  const title = [
    `Swing ${r.score}/100`,
    r.rsi != null ? `RSI(14) ${r.rsi.toFixed(0)}` : null,
    r.pctAbove20 != null
      ? `${r.pctAbove20 >= 0 ? "+" : ""}${r.pctAbove20.toFixed(1)}% vs 20d MA`
      : null,
    r.pctAbove50 != null
      ? `${r.pctAbove50 >= 0 ? "+" : ""}${r.pctAbove50.toFixed(1)}% vs 50d MA`
      : null,
    r.suggestion ?? "no trim signal",
    "Advisory — committee decides, you execute.",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span className={BAND_CLASS[r.band]} title={title}>
      {r.score}
      {r.band === "earnings-hold" && <span className="ml-1">⚠</span>}
      {r.suggestion && r.band !== "earnings-hold" && (
        <span className="ml-1 hidden text-[11px] text-muted-foreground xl:inline">
          {r.suggestion}
        </span>
      )}
    </span>
  );
}

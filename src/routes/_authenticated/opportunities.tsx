import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getQuotesFn } from "@/lib/marketServer";
import { useHoldings, useUniverse } from "@/hooks/useAppData";
import { resolveUniverse, universeEmptyReason, heldSymbolSet, normaliseSymbol } from "@/lib/universe";
import { fmtUSD } from "@/lib/finance";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/opportunities")({ component: Page });

function Page() {
  const { data: holdings = [] } = useHoldings();
  const { data: universe = [], isLoading: universeLoading } = useUniverse();
  // Same normalisation as the scan list, or the "Held" badge silently
  // disappears for a symbol stored as "msft" (Copilot, post-merge review).
  const held = heldSymbolSet(holdings.map((h) => h.symbol));
  const universeSymbols = universe.map((u) => u.symbol);
  const heldSymbols = holdings.map((h) => h.symbol);
  const symbols = resolveUniverse(universeSymbols, heldSymbols);
  const emptyReason = universeEmptyReason(universeSymbols, heldSymbols);
  const { data: quotes, isLoading } = useQuery({
    queryKey: ["opps-quotes", symbols.join(",")],
    queryFn: () => getQuotesFn({ data: { symbols } }),
    enabled: symbols.length > 0,
    refetchInterval: 60 * 1000,
  });
  const rows = Object.entries(quotes ?? {})
    .map(([sym, q]) => ({ sym, price: q.price, changePct: q.changePct }))
    .filter((r) => Number.isFinite(r.changePct));

  const List = ({ title, items, tone }: { title: string; items: typeof rows; tone: "up" | "down" }) => (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {items.map((r) => (
          <div key={r.sym} className="flex items-center justify-between border-b py-1.5 text-sm last:border-0">
            <span className="flex items-center gap-2 font-medium">
              {r.sym}
              {held.has(normaliseSymbol(r.sym)) && <Badge className="px-1.5 py-0 text-[10px]">Held</Badge>}
            </span>
            <span className="flex gap-3 tabular-nums">
              <span>{fmtUSD(r.price, 2)}</span>
              <span className={cn("w-16 text-right", tone === "up" ? "text-emerald-500" : "text-red-500")}>
                {r.changePct >= 0 ? "+" : ""}{r.changePct.toFixed(2)}%
              </span>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );

  const up = [...rows].sort((a, b) => b.changePct - a.changePct).slice(0, 8);
  const down = [...rows].sort((a, b) => a.changePct - b.changePct).slice(0, 8);

  return (
    <AppShell title="Opportunities" subtitle="Daily percentage movers across your holdings and investment universe. A price screen — not a committee view, and not ranked by conviction.">
      {universeLoading || isLoading ? (
        <p className="text-sm text-muted-foreground">Scanning the universe…</p>
      ) : null}

      {/* Empty must look empty, and must say which kind of empty it is. A blank
          table here previously meant "the hardcoded list returned nothing",
          which could not happen; now it can, and the reason matters. */}
      {!universeLoading && emptyReason ? (
        <div className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
          {emptyReason === "none-configured"
            ? "No investment universe configured and no holdings to scan. Add names to investment_universe, or import a portfolio, and this page will screen them."
            : "No investment universe configured — screening your holdings only. Add names to investment_universe to widen the scan."}
        </div>
      ) : null}

      {symbols.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          <List title="Today's strength (possible momentum)" items={up} tone="up" />
          <List title="Today's weakness (possible entries)" items={down} tone="down" />
        </div>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        Price movement is a screen, not a thesis — run the Morning Review for committee-ranked opportunities with entries, targets, and stops.
      </p>
    </AppShell>
  );
}

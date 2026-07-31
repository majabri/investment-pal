import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getQuotesFn } from "@/lib/marketServer";
import { useHoldings } from "@/hooks/useAppData";
import { fmtUSD } from "@/lib/finance";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/opportunities")({ component: Page });

const UNIVERSE = ["NVDA","AVGO","TSM","AMD","LRCX","MSFT","AMZN","GOOGL","META","CRWD","PANW","NOW","INTU","COST","NFLX","V","MA","RY","BLK","BRK.B","ABT","LLY","TSLA","AAPL"];

function Page() {
  const { data: holdings = [] } = useHoldings();
  const held = new Set(holdings.map((h) => h.symbol));
  const symbols = [...new Set([...UNIVERSE, ...holdings.map((h) => h.symbol)])];
  const { data: quotes, isLoading } = useQuery({
    queryKey: ["opps-quotes"],
    queryFn: () => getQuotesFn({ data: { symbols } }),
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
              {held.has(r.sym) && <Badge className="px-1.5 py-0 text-[10px]">Held</Badge>}
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
    <AppShell title="Opportunities" subtitle="Live daily movers across the held + watchlist universe — conviction ranking comes from the Investment Committee">
      {isLoading && <p className="text-sm text-muted-foreground">Scanning the universe…</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <List title="Today's strength (possible momentum)" items={up} tone="up" />
        <List title="Today's weakness (possible entries)" items={down} tone="down" />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Price movement is a screen, not a thesis — run the Morning Review for committee-ranked opportunities with entries, targets, and stops.
      </p>
    </AppShell>
  );
}

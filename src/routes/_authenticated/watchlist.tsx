import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getQuotesFn } from "@/lib/marketServer";
import { fmtUSD } from "@/lib/finance";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/watchlist")({ component: Page });

const LISTS: Record<string, string[]> = {
  "AI & Semis": ["NVDA", "AVGO", "TSM", "AMD", "LRCX", "MSFT", "AMZN", "GOOGL", "META"],
  Cybersecurity: ["CRWD", "PANW"],
  Software: ["NOW", "INTU"],
  Consumer: ["COST", "NFLX", "V", "MA"],
  "Dividend & Value": ["RY", "BLK", "BRK.B", "ABT", "LLY"],
};
const ALL = [...new Set(Object.values(LISTS).flat())];

function Page() {
  const { data: quotes } = useQuery({
    queryKey: ["watchlist-quotes"],
    queryFn: () => getQuotesFn({ data: { symbols: ALL } }),
    refetchInterval: 60 * 1000,
  });
  return (
    <AppShell title="Investment Watchlist" subtitle="Live prices, refreshed every minute">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(LISTS).map(([theme, syms]) => (
          <Card key={theme}>
            <CardHeader><CardTitle className="text-base">{theme}</CardTitle></CardHeader>
            <CardContent>
              {syms.map((s) => {
                const q = quotes?.[s];
                return (
                  <div key={s} className="flex items-center justify-between border-b py-1.5 text-sm last:border-0">
                    <span className="font-medium">{s}</span>
                    {q ? (
                      <span className="flex gap-3 tabular-nums">
                        <span>{fmtUSD(q.price, 2)}</span>
                        <span className={cn("w-16 text-right", q.changePct >= 0 ? "text-emerald-500" : "text-red-500")}>
                          {q.changePct >= 0 ? "+" : ""}{q.changePct.toFixed(2)}%
                        </span>
                      </span>
                    ) : <span className="text-xs text-muted-foreground">…</span>}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}

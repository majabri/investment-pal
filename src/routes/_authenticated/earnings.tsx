import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getEarningsCalendarFn } from "@/lib/calendarServer";
import { useHoldings } from "@/hooks/useAppData";

export const Route = createFileRoute("/_authenticated/earnings")({ component: Page });

const WATCH = ["NVDA","AVGO","TSM","AMD","META","COST","NFLX","NOW","PANW","MA","LLY","BRK.B","V","MSFT","AMZN","GOOGL","CRWD","LRCX","TSLA","INTU","ABT","BLK","RY","AAPL"];

function Page() {
  const { data: holdings = [] } = useHoldings();
  const symbols = [...new Set([...holdings.map((h) => h.symbol), ...WATCH])];
  const { data: events = [], isLoading } = useQuery({
    queryKey: ["earnings-cal", symbols.join(",")],
    queryFn: () => getEarningsCalendarFn({ data: { symbols, days: 14 } }),
    refetchInterval: 60 * 60 * 1000,
  });
  const held = new Set(holdings.map((h) => h.symbol));
  return (
    <AppShell title="Earnings" subtitle="Next 14 days — held and watchlist names, live from Nasdaq's calendar">
      <Card><CardContent className="pt-6">
        {isLoading && <p className="text-sm text-muted-foreground">Loading live earnings calendar…</p>}
        {!isLoading && events.length === 0 && <p className="text-sm text-muted-foreground">No held/watchlist earnings in the next 14 days.</p>}
        <table className="w-full text-sm">
          <tbody>
            {events.map((e) => (
              <tr key={e.symbol + e.date} className="border-b last:border-0">
                <td className="py-2 tabular-nums">{e.date}</td>
                <td className="font-medium">{e.symbol}</td>
                <td className="text-muted-foreground">{e.session === "bmo" ? "Before open" : "After close"}</td>
                <td>{held.has(e.symbol) ? <Badge>Held</Badge> : <Badge variant="secondary">Watchlist</Badge>}</td>
                <td className="text-right text-[11px] text-muted-foreground">{e.source === "live" ? "live" : "seed"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </AppShell>
  );
}

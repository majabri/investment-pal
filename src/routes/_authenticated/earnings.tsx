import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EARNINGS_EVENTS } from "@/lib/data/calendars";

export const Route = createFileRoute("/_authenticated/earnings")({ component: Page });

function Page() {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <AppShell title="Earnings" subtitle="Portfolio and watchlist reporting dates">
      <Card><CardContent className="pt-6">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">
            <th className="py-2">Date</th><th>Symbol</th><th>Session</th><th>Relevance</th></tr></thead>
          <tbody>
            {EARNINGS_EVENTS.filter((e) => e.date >= today).map((e) => (
              <tr key={e.symbol + e.date} className="border-b last:border-0">
                <td className="py-2 tabular-nums">{e.date}</td>
                <td className="font-medium">{e.symbol}</td>
                <td className="text-muted-foreground">{e.session === "bmo" ? "Before open" : "After close"}</td>
                <td>{e.inPortfolio ? <Badge>Held</Badge> : e.onWatchlist ? <Badge variant="secondary">Watchlist</Badge> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">Seed calendar — edit src/lib/data/calendars.ts or ask Lovable/Claude to refresh dates.</p>
      </CardContent></Card>
    </AppShell>
  );
}

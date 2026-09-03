import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getEarningsCalendarFn } from "@/lib/calendarServer";
import { useHoldings, useUniverse } from "@/hooks/useAppData";
import { resolveUniverse, universeEmptyReason, heldSymbolSet, normaliseSymbol } from "@/lib/universe";

export const Route = createFileRoute("/_authenticated/earnings")({ component: Page });

function Page() {
  const { data: holdings = [] } = useHoldings();
  const { data: universe = [], isLoading: universeLoading } = useUniverse();
  const universeSymbols = universe.map((u) => u.symbol);
  const heldSymbols = holdings.map((h) => h.symbol);
  const symbols = resolveUniverse(universeSymbols, heldSymbols);
  const emptyReason = universeEmptyReason(universeSymbols, heldSymbols);
  const { data: events = [], isLoading } = useQuery({
    queryKey: ["earnings-cal", symbols.join(",")],
    queryFn: () => getEarningsCalendarFn({ data: { symbols, days: 14 } }),
    enabled: symbols.length > 0,
    refetchInterval: 60 * 60 * 1000,
  });
  // Same normalisation as the scan list (Copilot, post-merge review).
  const held = heldSymbolSet(holdings.map((h) => h.symbol));
  return (
    <AppShell title="Earnings" subtitle="Next 14 days — your holdings and investment universe, live from Nasdaq's calendar">
      <Card><CardContent className="pt-6">
        {(universeLoading || isLoading) && <p className="text-sm text-muted-foreground">Loading live earnings calendar…</p>}
        {/* Distinguish "nothing to scan" from "nothing reports soon" — the old
            copy could only ever mean the latter, because the list was baked in. */}
        {!universeLoading && emptyReason ? (
          <p className="text-sm text-muted-foreground">
            {emptyReason === "none-configured"
              ? "No investment universe configured and no holdings. Add names to investment_universe, or import a portfolio, to see their earnings dates."
              : "No investment universe configured — showing earnings for your holdings only."}
          </p>
        ) : null}
        {!universeLoading && !isLoading && !emptyReason && events.length === 0 && (
          <p className="text-sm text-muted-foreground">No earnings for these names in the next 14 days.</p>
        )}
        <table className="w-full text-sm">
          <tbody>
            {events.map((e) => (
              <tr key={e.symbol + e.date} className="border-b last:border-0">
                <td className="py-2 tabular-nums">{e.date}</td>
                <td className="font-medium">{e.symbol}</td>
                <td className="text-muted-foreground">{e.session === "bmo" ? "Before open" : "After close"}</td>
                <td>{held.has(normaliseSymbol(e.symbol)) ? <Badge>Held</Badge> : <Badge variant="secondary">Universe</Badge>}</td>
                <td className="text-right text-[11px] text-muted-foreground">{e.source === "live" ? "live" : "seed"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </AppShell>
  );
}

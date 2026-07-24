import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/kids-watchlist")({
  component: Page,
});

function Page() {
  return (
    <AppShell title="Kids Watchlist" subtitle="Approved and preferred-future names only">
      <Card>
        <CardHeader><CardTitle className="text-base">From Family Policy v1.0</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>Core: MSFT, AMZN, GOOGL, V, AVGO, BLK, ABT, RY</p>
          <p>Preferred future: NVDA, META, COST, LLY, BRK.B, CRWD, PANW, NFLX, TSM, NOW</p>
          <p>Speculative cap 5% (CLSK). No additions unless approved by the committee.</p>
        </CardContent>
      </Card>
    </AppShell>
  );
}

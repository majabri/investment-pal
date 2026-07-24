import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/watchlist")({
  component: Page,
});

function Page() {
  return (
    <AppShell title="Investment Watchlist" subtitle="Amir — names under active consideration">
      <Card>
        <CardHeader><CardTitle className="text-base">Coming from the Investment OS</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>AI: MSFT, NVDA, AVGO, AMZN, GOOGL, META, TSM, AMD</p>
          <p>Cybersecurity: CRWD, PANW</p>
          <p>Software: NOW, INTU</p>
          <p>Consumer: COST, NFLX, V, MA</p>
          <p>Full watchlist engine (add/remove, price columns, notes) lands in the next PR.</p>
        </CardContent>
      </Card>
    </AppShell>
  );
}

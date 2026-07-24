import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/kids")({
  component: Page,
});

function Page() {
  return (
    <AppShell title="Kids Dashboard" subtitle="Family Investment OS — $200K per child by July 2036">
      <Card>
        <CardHeader><CardTitle className="text-base">Karim (12) · Zain (9) · Jude (6)</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>Three independent custodial portfolios, ~$5,100 each, 15 identical positions.</p>
          <p>$100 per child every other Thursday (next: July 30).</p>
          <p>Per-child target meters, Portfolio Scores (0–100), and holdings tables port from the Investment OS in the next PR.</p>
        </CardContent>
      </Card>
    </AppShell>
  );
}

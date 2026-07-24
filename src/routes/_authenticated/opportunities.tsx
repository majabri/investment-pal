import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/opportunities")({
  component: Page,
});

function Page() {
  return (
    <AppShell title="Opportunities" subtitle="Ideas under research, ranked by conviction">
      <Card>
        <CardHeader><CardTitle className="text-base">Ports from the Investment OS next PR</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>Thesis, catalyst, risk, time horizon, confidence 1–10 per idea.</p>
          <p>Feeds the ⭐ highest-conviction slot on the dashboard.</p>
        </CardContent>
      </Card>
    </AppShell>
  );
}

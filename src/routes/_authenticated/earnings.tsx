import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/earnings")({
  component: Page,
});

function Page() {
  return (
    <AppShell title="Earnings" subtitle="Portfolio and watchlist reporting dates">
      <Card>
        <CardHeader><CardTitle className="text-base">Ports next PR</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>Held names flagged, before-open/after-close sessions, expected-move context.</p>
          <p>Feeds Today's Priorities on the dashboard.</p>
        </CardContent>
      </Card>
    </AppShell>
  );
}

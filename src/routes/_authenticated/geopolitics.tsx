import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/geopolitics")({
  component: Page,
});

function Page() {
  return (
    <AppShell title="Geopolitics" subtitle="Market-relevant developments, impact-rated">
      <Card>
        <CardHeader><CardTitle className="text-base">Ports next PR</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>Middle East, China/Taiwan, Russia, trade & tariffs, energy, semiconductors — Green/Yellow/Red impact.</p>
        </CardContent>
      </Card>
    </AppShell>
  );
}

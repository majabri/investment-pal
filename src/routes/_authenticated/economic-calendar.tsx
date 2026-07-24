import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/economic-calendar")({
  component: Page,
});

function Page() {
  return (
    <AppShell title="Economic Calendar" subtitle="CPI, PPI, jobs, GDP, Fed">
      <Card>
        <CardHeader><CardTitle className="text-base">Ports next PR</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>High/medium/low impact ratings; high-impact events surface as dashboard priorities.</p>
        </CardContent>
      </Card>
    </AppShell>
  );
}

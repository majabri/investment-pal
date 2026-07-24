import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GEO_EVENTS } from "@/lib/data/calendars";

export const Route = createFileRoute("/_authenticated/geopolitics")({ component: Page });

function Page() {
  const tone = { high: "destructive", medium: "default", low: "secondary" } as const;
  return (
    <AppShell title="Geopolitics" subtitle="Only developments that matter for markets, impact-rated">
      <div className="grid gap-4 md:grid-cols-2">
        {GEO_EVENTS.map((g) => (
          <Card key={g.title}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{g.region}</CardTitle>
              <Badge variant={tone[g.impact]}>{g.impact}</Badge>
            </CardHeader>
            <CardContent className="text-sm">
              <p className="font-medium">{g.title}</p>
              <p className="mt-1 text-muted-foreground">{g.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}

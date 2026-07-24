import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ECON_EVENTS } from "@/lib/data/calendars";

export const Route = createFileRoute("/_authenticated/economic-calendar")({ component: Page });

function Page() {
  const today = new Date().toISOString().slice(0, 10);
  const tone = { high: "destructive", medium: "default", low: "secondary" } as const;
  return (
    <AppShell title="Economic Calendar" subtitle="High-impact events surface as dashboard priorities">
      <Card><CardContent className="pt-6 space-y-2">
        {ECON_EVENTS.filter((e) => e.date >= today).map((e) => (
          <div key={e.name + e.date} className="flex items-center gap-3 border-b pb-2 text-sm last:border-0">
            <span className="w-24 tabular-nums text-muted-foreground">{e.date}</span>
            <span className="flex-1 font-medium">{e.name}</span>
            <Badge variant={tone[e.importance]}>{e.importance}</Badge>
          </div>
        ))}
      </CardContent></Card>
    </AppShell>
  );
}

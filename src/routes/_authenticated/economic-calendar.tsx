import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getEconCalendarFn } from "@/lib/calendarServer";
import { coverageNotice, coverageOf } from "@/lib/coverage";

export const Route = createFileRoute("/_authenticated/economic-calendar")({ component: Page });

function Page() {
  // The whole query, not just its data: a failed fetch settles `isLoading` to
  // false and the `= []` default fills in, so this page rendered an empty card
  // with no message — which reads as "no economic events in the next 10 days"
  // (rule 30).
  const query = useQuery({
    queryKey: ["econ-cal"],
    queryFn: () => getEconCalendarFn({ data: { days: 10 } }),
    refetchInterval: 60 * 60 * 1000,
  });
  const events = query.data ?? [];
  const coverage = coverageOf(query);
  const tone = { high: "destructive", medium: "default", low: "secondary" } as const;
  const shown = events.filter((e) => e.importance !== "low").slice(0, 40);
  return (
    <AppShell
      title="Economic Calendar"
      subtitle="US events, next 10 days — live from Nasdaq's calendar; high-impact feeds the Office alerts"
    >
      <Card>
        <CardContent className="space-y-2 pt-6">
          {(() => {
            const notice = coverageNotice(
              "economic events",
              coverage,
              shown.length,
              "No high- or medium-impact US events in the next 10 days.",
            );
            return notice === null ? null : (
              <p
                className={
                  coverage === "UNAVAILABLE"
                    ? "text-sm font-medium text-amber-600 dark:text-amber-400"
                    : "text-sm text-muted-foreground"
                }
              >
                {notice}
              </p>
            );
          })()}
          {shown.map((e, i) => (
            <div
              key={e.name + e.date + i}
              className="flex items-center gap-3 border-b pb-2 text-sm last:border-0"
            >
              <span className="w-24 tabular-nums text-muted-foreground">{e.date}</span>
              <span className="w-12 text-xs text-muted-foreground">{e.time?.slice(0, 5)}</span>
              <span className="min-w-40 flex-1 font-medium">{e.name}</span>
              {e.consensus ? (
                <span className="text-xs text-muted-foreground">est {e.consensus}</span>
              ) : null}
              <Badge variant={tone[e.importance]}>{e.importance}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </AppShell>
  );
}

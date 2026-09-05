import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getGeopoliticsFn } from "@/lib/newsServer";
import { coverageNotice, coverageOf } from "@/lib/coverage";

export const Route = createFileRoute("/_authenticated/geopolitics")({ component: Page });

function Page() {
  // The whole query, not just its data (rule 30). A failed fetch used to
  // render "Nothing market-relevant right now." — an explicit claim about the
  // world, made from an error nobody saw.
  const query = useQuery({
    queryKey: ["geo"],
    queryFn: () => getGeopoliticsFn(),
    refetchInterval: 15 * 60 * 1000,
  });
  const items = query.data ?? [];
  const coverage = coverageOf(query);
  const tone = { high: "destructive", medium: "default", low: "secondary" } as const;
  return (
    <AppShell
      title="Geopolitics"
      subtitle="Live market-relevant developments from world coverage, impact-rated"
    >
      {(() => {
        const notice = coverageNotice(
          "market-relevant developments",
          coverage,
          items.length,
          "Nothing market-relevant right now.",
        );
        return notice === null ? null : (
          <p
            className={
              coverage === "UNAVAILABLE"
                ? "mb-3 text-sm font-medium text-amber-600 dark:text-amber-400"
                : "mb-3 text-sm text-muted-foreground"
            }
          >
            {notice}
          </p>
        );
      })()}
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((g) => (
          <Card key={g.link}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">{g.region}</CardTitle>
              <Badge variant={tone[g.impact]}>{g.impact}</Badge>
            </CardHeader>
            <CardContent className="text-sm">
              <a
                href={g.link}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:underline"
              >
                {g.title}
              </a>
              <p className="mt-1 text-xs text-muted-foreground">{g.source}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}

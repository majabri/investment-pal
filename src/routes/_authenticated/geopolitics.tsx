import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getGeopoliticsFn } from "@/lib/newsServer";

export const Route = createFileRoute("/_authenticated/geopolitics")({ component: Page });

function Page() {
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["geo"],
    queryFn: () => getGeopoliticsFn(),
    refetchInterval: 15 * 60 * 1000,
  });
  const tone = { high: "destructive", medium: "default", low: "secondary" } as const;
  return (
    <AppShell
      title="Geopolitics"
      subtitle="Live market-relevant developments from world coverage, impact-rated"
    >
      {isLoading && <p className="text-sm text-muted-foreground">Scanning world coverage…</p>}
      {!isLoading && items.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing market-relevant right now.</p>
      )}
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

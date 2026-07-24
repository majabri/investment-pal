import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/watchlist")({ component: Page });

const LISTS: Record<string, string[]> = {
  "AI & Semis": ["NVDA", "AVGO", "TSM", "AMD", "LRCX", "MSFT", "AMZN", "GOOGL", "META"],
  Cybersecurity: ["CRWD", "PANW"],
  Software: ["NOW", "INTU"],
  Consumer: ["COST", "NFLX", "V", "MA"],
  "Dividend & Value": ["RY", "BLK", "BRK.B", "ABT", "LLY"],
};

function Page() {
  return (
    <AppShell title="Investment Watchlist" subtitle="Amir — names under active consideration, grouped by theme">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(LISTS).map(([theme, syms]) => (
          <Card key={theme}>
            <CardHeader><CardTitle className="text-base">{theme}</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {syms.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}

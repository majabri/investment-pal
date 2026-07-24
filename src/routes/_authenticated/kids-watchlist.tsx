import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FAMILY_POLICY } from "@/lib/data/familyPolicy";

export const Route = createFileRoute("/_authenticated/kids-watchlist")({ component: Page });

function Page() {
  const groups: [string, readonly string[]][] = [
    ["Core (permanent)", FAMILY_POLICY.core],
    ["Supporting", FAMILY_POLICY.supporting],
    ["Preferred future", FAMILY_POLICY.preferredFuture],
    [`Speculative (max ${FAMILY_POLICY.speculative.maxPct}%)`, FAMILY_POLICY.speculative.symbols],
  ];
  return (
    <AppShell title="Kids Watchlist" subtitle="Family Policy v1.0 — approved universe only; committee approval required for additions">
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map(([t, syms]) => (
          <Card key={t}>
            <CardHeader><CardTitle className="text-base">{t}</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {syms.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}

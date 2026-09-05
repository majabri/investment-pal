import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FAMILY_POLICY } from "@/lib/data/familyPolicy";
import { getQuotesFn } from "@/lib/marketServer";
import { fmtUSD } from "@/lib/finance";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/kids-watchlist")({ component: Page });

function Page() {
  const groups: [string, readonly string[]][] = [
    ["Core (permanent)", FAMILY_POLICY.core],
    ["Supporting", FAMILY_POLICY.supporting],
    ["Preferred future", FAMILY_POLICY.preferredFuture],
    [`Speculative (max ${FAMILY_POLICY.speculative.maxPct}%)`, FAMILY_POLICY.speculative.symbols],
  ];
  const all = [...new Set(groups.flatMap(([, s]) => [...s]))];
  const { data: quotes } = useQuery({
    queryKey: ["kids-watchlist-quotes"],
    queryFn: () => getQuotesFn({ data: { symbols: all } }),
    refetchInterval: 60 * 1000,
  });
  return (
    <AppShell
      title="Kids Watchlist"
      subtitle="Approved universe with live prices — committee approval required for additions"
    >
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map(([t, syms]) => (
          <Card key={t}>
            <CardHeader>
              <CardTitle className="text-base">{t}</CardTitle>
            </CardHeader>
            <CardContent>
              {syms.map((s) => {
                const q = quotes?.[s];
                return (
                  <div
                    key={s}
                    className="flex items-center justify-between border-b py-1.5 text-sm last:border-0"
                  >
                    <span className="font-medium">{s}</span>
                    {q ? (
                      <span className="flex gap-3 tabular-nums">
                        <span>{fmtUSD(q.price, 2)}</span>
                        <span
                          className={cn(
                            "w-16 text-right",
                            q.changePct >= 0 ? "text-emerald-500" : "text-red-500",
                          )}
                        >
                          {q.changePct >= 0 ? "+" : ""}
                          {q.changePct.toFixed(2)}%
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">…</span>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}

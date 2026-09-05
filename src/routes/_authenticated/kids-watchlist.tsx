import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BUCKET_LABEL, byBucket } from "@/lib/strategy";
import { useStrategies, useStrategySymbols } from "@/hooks/useAppData";
import { getQuotesFn } from "@/lib/marketServer";
import { fmtUSD } from "@/lib/finance";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/kids-watchlist")({ component: Page });

function Page() {
  // The approved universe is data now (rules 16, 21). It was four arrays and a
  // 5% cap compiled into `familyPolicy.ts`, so every user of this app saw one
  // household's approved list and could change it only by changing the source.
  const { data: strategies = [] } = useStrategies();
  const { data: symbols = [] } = useStrategySymbols();
  const strategy = strategies[0] ?? null;
  const mine = strategy === null ? [] : symbols.filter((s) => s.strategy_id === strategy.id);
  const groups: [string, readonly string[]][] = byBucket(mine).map(([b, list]) => [
    // The speculative cap belongs to the strategy and is only stated when it
    // has one. `max 5%` was a constant; `max NULL%` is not a heading.
    b === "speculative" && strategy?.speculative_max_pct != null
      ? `${BUCKET_LABEL[b]} (max ${strategy.speculative_max_pct}%)`
      : BUCKET_LABEL[b],
    list,
  ]);
  const all = [...new Set(groups.flatMap(([, s]) => [...s]))];
  const { data: quotes } = useQuery({
    queryKey: ["kids-watchlist-quotes", all.join(",")],
    queryFn: () => getQuotesFn({ data: { symbols: all } }),
    // Asking a quote provider for zero symbols is a request that can only fail
    // or return nothing; the empty state below is the answer instead.
    enabled: all.length > 0,
    refetchInterval: 60 * 1000,
  });

  if (groups.length === 0) {
    return (
      <AppShell title="Kids Watchlist" subtitle="No approved universe set">
        <Card>
          <CardContent className="space-y-3 pt-6 text-sm">
            <p className="font-medium">There is no approved universe yet.</p>
            <p className="text-muted-foreground">
              This page lists the symbols a strategy approves, in its own buckets. Nothing is
              approved for you — the list that used to be here belonged to one household and was
              compiled into the app.
            </p>
            <p className="text-muted-foreground">
              Create a strategy and add symbols under <strong>Settings → Strategy</strong>.
            </p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Kids Watchlist"
      subtitle={`${strategy?.name ?? "Strategy"} — approved universe with live prices`}
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

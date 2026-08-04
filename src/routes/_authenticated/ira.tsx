import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CommitteeChat } from "@/components/app/CommitteeChat";
import { useAccounts, useHoldings } from "@/hooks/useAppData";
import { accountCategory } from "@/lib/data/accountGroups";
import { getQuotesFn } from "@/lib/marketServer";
import { fmtUSD, fmtPct } from "@/lib/finance";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/ira")({ component: Page });

/** Monthly review is due during the first 5 calendar days of each month. */
function reviewDue(): boolean { return new Date().getDate() <= 5; }

function Page() {
  const { data: accounts = [] } = useAccounts();
  const { data: allHoldings = [] } = useHoldings();
  const iraAccounts = accounts.filter((a) => accountCategory(a.name) === "IRA");
  const symbols = useMemo(() => [...new Set(allHoldings
    .filter((h) => iraAccounts.some((a) => a.id === h.account_id))
    .map((h) => h.symbol))], [allHoldings, iraAccounts]);
  const { data: quotes } = useQuery({
    queryKey: ["ira-quotes", symbols.join(",")],
    queryFn: () => getQuotesFn({ data: { symbols } }),
    enabled: symbols.length > 0,
    refetchInterval: 60 * 1000,
  });
  const px = (h: { symbol: string; current_price: number }) => quotes?.[h.symbol]?.price ?? h.current_price;

  const rows = iraAccounts.map((a) => {
    const hs = allHoldings.filter((h) => h.account_id === a.id);
    const value = hs.reduce((s, h) => s + h.quantity * px(h), 0) + Number(a.cash ?? 0);
    const cost = hs.reduce((s, h) => s + h.quantity * h.cost_basis, 0);
    const day = hs.reduce((s, h) => {
      const q = quotes?.[h.symbol];
      return q && q.prevClose > 0 ? s + h.quantity * (q.price - q.prevClose) : s;
    }, 0);
    return { a, hs, value, cost, day };
  });
  const total = rows.reduce((s, r) => s + r.value, 0);
  const totalDay = rows.reduce((s, r) => s + r.day, 0);

  const prompt = useMemo(() => {
    const data = rows.map((r) =>
      `${r.a.name}: ${fmtUSD(r.value)} (cash ${fmtUSD(Number(r.a.cash ?? 0), 2)})` +
      (r.hs.length ? " — " + r.hs.map((h) => `${h.symbol} ${h.quantity}sh @ ${fmtUSD(px(h), 2)} (avg ${fmtUSD(h.cost_basis, 2)})`).join(", ") : " — no positions"),
    ).join("\n");
    return `Monthly Retirement Committee Review — IRA Accounts

You are my Retirement Investment Committee. Today is my monthly review of my IRA accounts (Roth IRA and Rollover IRA). These are tax-advantaged retirement accounts with a multi-decade horizon.

Rules
* Long-term investing only — no margin, no options, no speculation
* Tax-advantaged space is precious: prioritize highest long-term compounders
* Consider Roth vs Traditional placement (highest-growth assets belong in Roth)
* 2026 IRA contribution limit: $7,000 (under 50) — track progress toward maxing it
* Do not recommend activity for activity's sake

Analyze in order:
1. Executive Summary — is the retirement sleeve healthy?
2. Contribution Status — YTD contributions vs the $7,000 limit; recommend a funding plan
3. Account Review — each IRA: holdings, allocation, idle cash
4. Placement Review — are the right assets in the right account type?
5. Opportunity Ranking — best 5 long-term compounders for new retirement dollars today
6. Recommendation — exactly what to do this month (fund / buy / hold), with amounts
7. Devil's Advocate — strongest case against the recommendation
8. Next Month Plan
End with a one-page Retirement Action Sheet.

MY VERIFIED DATA (live prices as of ${new Date().toLocaleString("en-US")})
${data || "(no IRA accounts found — import from Fidelity or add in Settings)"}
IRA total: ${fmtUSD(total)}`;
  }, [rows, total]);

  return (
    <AppShell title="IRA — Retirement" subtitle="Tax-advantaged accounts · live-priced · monthly committee review">
      <div className="mb-4 flex items-center gap-3">
        <div className="text-sm">
          <span className="font-semibold">{fmtUSD(total)}</span>
          <span className={cn("ml-2 tabular-nums", totalDay >= 0 ? "text-emerald-500" : "text-red-500")}>
            {totalDay >= 0 ? "+" : ""}{fmtUSD(totalDay)} today
          </span>
        </div>
        {reviewDue() && <Badge variant="destructive">Monthly review due</Badge>}
      </div>
      {rows.length === 0 && (
        <Card className="mb-4">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">No IRA accounts yet.</p>
            <p>They appear here automatically after your next Fidelity import with
            <span className="font-medium"> "Create accounts for everything in the file" </span>
            switched on (Settings → Portfolio CSV Import) — your ROTH IRA and ROLLOVER IRA
            will be created and grouped here with live prices. You can also add one manually
            in Settings → Add account.</p>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map(({ a, hs, value, day }) => (
          <Card key={a.id}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">{a.name}</CardTitle>
              <span className={cn("text-xs tabular-nums", day >= 0 ? "text-emerald-500" : "text-red-500")}>
                {day >= 0 ? "+" : ""}{fmtUSD(day)} today
              </span>
            </CardHeader>
            <CardContent>
              <div className="mb-2 text-lg font-semibold tabular-nums">{fmtUSD(value)}</div>
              {hs.length === 0 && <p className="text-sm text-muted-foreground">No positions — cash {fmtUSD(Number(a.cash ?? 0), 2)}</p>}
              {hs.map((h) => {
                const q = quotes?.[h.symbol];
                const p = px(h);
                const gl = h.cost_basis > 0 ? (p - h.cost_basis) / h.cost_basis : null;
                return (
                  <div key={h.id} className="flex items-center justify-between border-b py-1.5 text-sm last:border-0">
                    <span className="font-medium">{h.symbol}</span>
                    <span className="flex gap-3 tabular-nums">
                      <span>{h.quantity} sh</span>
                      <span>{fmtUSD(p, 2)}</span>
                      {gl != null && (
                        <span className={cn("w-16 text-right", gl >= 0 ? "text-emerald-500" : "text-red-500")}>
                          {gl >= 0 ? "+" : ""}{fmtPct(gl)}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Monthly Retirement Committee Prompt</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{prompt}</pre>
            <div className="flex gap-2">
              <Button onClick={() => { void navigator.clipboard.writeText(prompt); toast.success("Copied"); }}>Copy Prompt</Button>
              <Button variant="secondary" onClick={() => window.open("https://chatgpt.com", "_blank")}>Open ChatGPT</Button>
            </div>
          </CardContent>
        </Card>
        <CommitteeChat systemPrompt={prompt} title="Retirement Committee Chat" />
      </div>
    </AppShell>
  );
}

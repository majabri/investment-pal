import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CommitteeChat } from "@/components/app/CommitteeChat";
import { FAMILY_POLICY, ageOf, nextContributionDate } from "@/lib/data/familyPolicy";
import { KIDS_SEED, type KidAccount } from "@/lib/data/kidsSeed";
import { useAccounts, useAllHoldings } from "@/hooks/useAppData";
import { getQuotesFn } from "@/lib/marketServer";
import { fmtUSD } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/kids-prompt-center")({ component: Page });

const KID_NAMES = ["Karim", "Zain", "Jude"];

function Page() {
  const { data: accounts = [] } = useAccounts();
  const { data: allHoldings = [] } = useAllHoldings();
  const dbKids = accounts.filter((a) => KID_NAMES.includes(a.name));
  const kidsData: KidAccount[] = dbKids.length
    ? dbKids.map((a) => ({
        key: a.name.toLowerCase(), name: a.name, accountNumber: "", cash: Number(a.cash ?? 0),
        holdings: allHoldings.filter((h) => h.account_id === a.id)
          .map((h) => ({ symbol: h.symbol, shares: Number(h.quantity), price: Number(h.current_price), avgCost: Number(h.cost_basis) })),
      }))
    : KIDS_SEED;
  const symbols = useMemo(() => [...new Set(kidsData.flatMap((k) => k.holdings.map((h) => h.symbol)))], [kidsData]);
  const { data: quotes } = useQuery({
    queryKey: ["kids-pc-quotes", symbols.join(",")],
    queryFn: () => getQuotesFn({ data: { symbols } }),
    enabled: symbols.length > 0,
    refetchInterval: 60 * 1000,
  });

  const prompt = useMemo(() => {
    const next = nextContributionDate().toISOString().slice(0, 10);
    const kidsLine = FAMILY_POLICY.children
      .map((c) => `${c.name} ${ageOf(c.birthDate)}`).join(", ");
    const data = kidsData.map((k) => {
      const live = k.holdings.map((h) => quotes?.[h.symbol] ? { ...h, price: quotes[h.symbol].price } : h);
      const mv = live.reduce((s, h) => s + h.shares * h.price, 0);
      return `${k.name}: ${fmtUSD(mv + k.cash)} (cash ${fmtUSD(k.cash, 2)}) — ` +
        live.map((h) => `${h.symbol} ${h.shares}sh @ ${fmtUSD(h.price, 2)} = ${fmtUSD(h.shares * h.price)}${h.avgCost > 0 ? ` (avg ${fmtUSD(h.avgCost, 2)})` : ""}`).join(", ");
    }).join("\n");
    return `Family Investment Committee – Biweekly Capital Allocation Review

Today is my biweekly investment review for my children's accounts (${kidsLine}).
Each account receives $${FAMILY_POLICY.contribution.amountUsd} today.

Objective
Maximize the probability of each child reaching $200,000 within 10 years through disciplined long-term investing.
These accounts are for:
* College
* First home
* Business
* Financial independence
This is not an income portfolio.

Investment Rules
* Long-term investing only
* No margin
* No options
* No leverage
* No market timing
* Buy only high-conviction businesses
* Use today's market data
* Challenge your own assumptions before making recommendations
* Do not recommend purchases simply because cash is available

Existing Holdings
Use the portfolio I provide for:
* Karim
* Zain
* Jude
Assume the portfolios should remain substantially identical unless there is a compelling reason otherwise.

Investment Committee Tasks
Analyze in the following order:

1. Executive Summary
   * Is today a good day to deploy capital?
   * What are the biggest macro and market developments since the last review?

2. Market Environment
   * Interest rates
   * Inflation
   * AI
   * Cloud
   * Semiconductors
   * Cybersecurity
   * Healthcare
   * Consumer
   * Financials
   * Market valuation
   * Major earnings
   * Geopolitical risks

3. Opportunity Ranking
Rank the 10 best investment opportunities for the next 10 years.
For each provide:
* Investment thesis
* Current valuation attractiveness
* Expected long-term CAGR
* Key risks
* Confidence (1–10)

4. Portfolio Review
Review each child's portfolio:
* Strengths
* Weaknesses
* Sector allocation
* Concentration risk
* Progress toward the $200,000 goal
* Required annual return from today to reach the target

5. Contribution Decision
The committee must recommend exactly one of the following:
* Add to an existing holding
* Start a new position
* Hold cash
If recommending a purchase, specify:
* Company
* Dollar amount ($100)
* Fractional shares (approximate)
* Why this is the highest expected-return decision today
* Why it is superior to every other candidate

6. Devil's Advocate Review
Challenge the recommendation by explaining:
* Why buying it could be a mistake
* The strongest alternative
* Why the final recommendation still wins

7. Next Contribution Plan
If today's purchase is executed, identify the highest-priority purchase for the next $100 contribution in two weeks.

8. Final Investment Committee Vote
For Karim: BUY / HOLD / SELL
For Zain: BUY / HOLD / SELL
For Jude: BUY / HOLD / SELL
Provide an overall confidence score (1–10).
End with a one-page Family Action Sheet containing only the final actions.

MY VERIFIED DATA (live prices as of ${new Date().toLocaleString("en-US")})
Next contribution date: ${next}
Approved universe (family policy — committee approval required for additions): Core ${FAMILY_POLICY.core.join(", ")}; Supporting ${FAMILY_POLICY.supporting.join(", ")}; Preferred future ${FAMILY_POLICY.preferredFuture.join(", ")}; Speculative cap ${FAMILY_POLICY.speculative.maxPct}% (${FAMILY_POLICY.speculative.symbols.join(", ")})
${data}`;
  }, [kidsData, quotes]);

  return (
    <AppShell title="Kids Prompt Center" subtitle="Biweekly Family Investment Committee — live-priced data, chat in-app or copy to ChatGPT">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Family Committee Prompt</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{prompt}</pre>
            <div className="flex gap-2">
              <Button onClick={() => { void navigator.clipboard.writeText(prompt); toast.success("Copied"); }}>Copy Prompt</Button>
              <Button variant="secondary" onClick={() => window.open("https://chatgpt.com", "_blank")}>Open ChatGPT</Button>
            </div>
          </CardContent>
        </Card>
        <CommitteeChat systemPrompt={prompt} title="Family Committee Chat" />
      </div>
    </AppShell>
  );
}

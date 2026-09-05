import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CommitteeChat } from "@/components/app/CommitteeChat";
import { FAMILY_POLICY } from "@/lib/data/familyPolicy";
import { nextContributionDate } from "@/lib/accountObjective";
import { kidAccounts, holderLabel } from "@/lib/kidAccounts";
import { useAccounts, useAllHoldings, useHouseholdMembers } from "@/hooks/useAppData";
import { getQuotesFn } from "@/lib/marketServer";
import { fmtUSD } from "@/lib/finance";
import { NOT_KNOWN, usdOrNotKnown } from "@/lib/unavailable";

export const Route = createFileRoute("/_authenticated/kids-prompt-center")({ component: Page });


function Page() {
  const { data: accounts = [] } = useAccounts();
  const { data: allHoldings = [] } = useAllHoldings();
  const { data: members = [] } = useHouseholdMembers();
  // By TYPE, not by a hardcoded list of first names (Phase 1b, rule 4), and
  // with no seed fallback: a prompt built from `KIDS_SEED` described somebody
  // else's children and somebody else's positions to a model, in the first
  // person, as the user's own (Phase 4, rule 22).
  const kidsData = useMemo(
    () => kidAccounts(accounts, allHoldings, members),
    [accounts, allHoldings, members],
  );
  const symbols = useMemo(
    () => [...new Set(kidsData.flatMap((k) => k.holdings.map((h) => h.symbol)))],
    [kidsData],
  );
  const { data: quotes } = useQuery({
    queryKey: ["kids-pc-quotes", symbols.join(",")],
    queryFn: () => getQuotesFn({ data: { symbols } }),
    enabled: symbols.length > 0,
    refetchInterval: 60 * 1000,
  });

  const prompt = useMemo(() => {
    // Earliest next contribution across the accounts that have a plan. This
    // read `FAMILY_POLICY.contribution.anchorDate`, so it returned the same
    // date for every user of the app (rule 20).
    const nextTimes = kidsData
      .map((k) => (k.objective.kind === "set" ? k.objective.contribution : null))
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map((c) => nextContributionDate(c).getTime());
    const next =
      nextTimes.length === 0
        ? NOT_KNOWN
        : new Date(Math.min(...nextTimes)).toISOString().slice(0, 10);

    // Each account's OWN objective, stated per account. A single global
    // "$200,000 by 2036" was one household's target asserted to the model as
    // this user's, and the model then reasoned about being behind on it.
    const objectives = kidsData
      .map((k) => {
        const o = k.objective;
        if (o.kind === "unset") {
          return `${holderLabel(k)}: target ${NOT_KNOWN} (missing ${o.missing.join(" and ")})`;
        }
        const plan = o.contribution
          ? `${usdOrNotKnown(o.contribution.amountUsd)} every ${o.contribution.cadenceDays} days`
          : `${NOT_KNOWN} — no contribution plan is recorded, so assume none`;
        return `${holderLabel(k)}: target ${usdOrNotKnown(o.targetValue)} by ${o.targetDate}; contribution ${plan}`;
      })
      .join("\n");
    // Whoever actually holds the accounts, with their age where a birth date
    // has been entered. This read a compiled-in list of three children, so the
    // prompt asserted their names and ages to the model regardless of whose
    // accounts were on screen.
    const kidsLine = kidsData.map(holderLabel).join(", ");
    const data = kidsData
      .map((k) => {
        const live = k.holdings.map((h) =>
          quotes?.[h.symbol] ? { ...h, price: quotes[h.symbol].price } : h,
        );
        const mv = live.reduce((s, h) => s + h.shares * h.price, 0);
        return (
          // Into a prompt: "$0.00" for an unknown balance reaches the model as
          // a fact about the account, which it then reasons from (Phase 1a).
          `${k.name}: ${usdOrNotKnown(k.cash === null ? null : mv + k.cash)} (cash ${usdOrNotKnown(
            k.cash,
            2,
          )}) — ` +
          live
            .map(
              (h) =>
                `${h.symbol} ${h.shares}sh @ ${fmtUSD(h.price, 2)} = ${fmtUSD(h.shares * h.price)}${h.avgCost > 0 ? ` (avg ${fmtUSD(h.avgCost, 2)})` : ""}`,
            )
            .join(", ")
        );
      })
      .join("\n");
    return `Family Investment Committee – Biweekly Capital Allocation Review

Today is my biweekly investment review for my children's accounts (${kidsLine}).
Each account's own objective and contribution plan, as recorded:
${objectives}

Where a target or a contribution plan is ${NOT_KNOWN}, treat it as NOT SET. Do not
substitute a figure, do not infer one from the other accounts, and do not judge
that account as ahead of or behind a target it does not have.

Objective
Maximize the probability of each account reaching its own recorded target by its own recorded date, through disciplined long-term investing.
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
${kidsData.map((k) => `* ${holderLabel(k)}`).join("\n")}
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
* Progress toward that account's own recorded target, where one is recorded
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
If today's purchase is executed, identify the highest-priority purchase for each account's next recorded contribution. Where no contribution plan is recorded, say so and skip that account rather than assuming one.

8. Final Investment Committee Vote
${kidsData.map((k) => `For ${holderLabel(k)}: BUY / HOLD / SELL`).join("\n")}
Provide an overall confidence score (1–10).
End with a one-page Family Action Sheet containing only the final actions.

MY VERIFIED DATA (live prices as of ${new Date().toLocaleString("en-US")})
Next contribution date: ${next}
Approved universe (family policy — committee approval required for additions): Core ${FAMILY_POLICY.core.join(", ")}; Supporting ${FAMILY_POLICY.supporting.join(", ")}; Preferred future ${FAMILY_POLICY.preferredFuture.join(", ")}; Speculative cap ${FAMILY_POLICY.speculative.maxPct}% (${FAMILY_POLICY.speculative.symbols.join(", ")})
${data}`;
  }, [kidsData, quotes]);

  // No custodial accounts: there is no prompt to build. Rendering the template
  // anyway would send a model a first-person brief about "my children's
  // accounts ()" with an empty holdings block and ask it to vote — the model
  // would fill the gap, and the answer would look like advice about a real
  // portfolio (rule 22, and rule 17's refusal to produce output without the
  // inputs it claims to rest on).
  if (kidsData.length === 0) {
    return (
      <AppShell title="Kids Prompt Center" subtitle="No custodial accounts yet">
        <Card>
          <CardContent className="space-y-3 pt-6 text-sm">
            <p className="font-medium">No prompt — there is nothing to ask about.</p>
            <p className="text-muted-foreground">
              This page builds a committee brief from your custodial accounts and the household
              members who hold them. You have none yet, so there is no brief. It will not send a
              model an empty portfolio and let it fill in the gaps.
            </p>
            <p className="text-muted-foreground">
              Add a custodial account in <strong>Settings → Accounts</strong>, add whoever it is
              for under <strong>Settings → Household</strong>, and import positions.
            </p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Kids Prompt Center"
      subtitle="Biweekly Family Investment Committee — live-priced data, chat in-app or copy to ChatGPT"
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Family Committee Prompt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">
              {prompt}
            </pre>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  void navigator.clipboard.writeText(prompt);
                  toast.success("Copied");
                }}
              >
                Copy Prompt
              </Button>
              <Button
                variant="secondary"
                onClick={() => window.open("https://chatgpt.com", "_blank")}
              >
                Open ChatGPT
              </Button>
            </div>
          </CardContent>
        </Card>
        <CommitteeChat systemPrompt={prompt} title="Family Committee Chat" />
      </div>
    </AppShell>
  );
}

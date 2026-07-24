import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CommitteeChat } from "@/components/app/CommitteeChat";
import { FAMILY_POLICY, nextContributionDate } from "@/lib/data/familyPolicy";
import { KIDS_SEED } from "@/lib/data/kidsSeed";
import { fmtUSD } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/kids-prompt-center")({ component: Page });

function buildKidsPrompt(): string {
  const next = nextContributionDate().toISOString().slice(0, 10);
  const data = KIDS_SEED.map((k) => {
    const mv = k.holdings.reduce((s, h) => s + h.shares * h.price, 0);
    return `${k.name}: ${fmtUSD(mv + k.cash)} — ` + k.holdings.map((h) => `${h.symbol} ${h.shares}sh ${fmtUSD(h.shares * h.price)}`).join(", ");
  }).join("\n");
  return `You are my Family Investment Committee. Today is my biweekly review for my children's investment accounts (Karim 12, Zain 9, Jude 6). Long-term wealth creation only: college, first home, business. NOT for income.
Rules: No margin. No options. No leverage. Long-term investing only. Each child receives $${FAMILY_POLICY.contribution.amountUsd} every two weeks. Do not recommend trades simply because cash is available.
${FAMILY_POLICY.parityRule}
Approved core: ${FAMILY_POLICY.core.join(", ")}. Supporting: ${FAMILY_POLICY.supporting.join(", ")}. Preferred future: ${FAMILY_POLICY.preferredFuture.join(", ")}. Speculative cap ${FAMILY_POLICY.speculative.maxPct}% (${FAMILY_POLICY.speculative.symbols.join(", ")}).
Target: $${FAMILY_POLICY.targetPerChild.toLocaleString()} per child by July 2036. Next contribution: ${next}.
Analyze: 1 Executive Summary, 2 Market Review, 3 Account Review per child, 4 Contribution Recommendation (exactly what today's $100 buys per child), 5 Portfolio Balance Review, 6 New Investment Ideas (up to 5), 7 Dividend Review, 8 Long-Term Outlook, 9 Next Contribution Plan, 10 Committee Decision. End with a one-page Family Action Sheet (Karim/Zain/Jude: Buy/Hold/Sell) and whether all three remain on track.

MY VERIFIED DATA
${data}`;
}

function Page() {
  const [prompt] = useState(buildKidsPrompt);
  return (
    <AppShell title="Kids Prompt Center" subtitle="Biweekly Family Investment Committee — chat in-app, or copy to ChatGPT">
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

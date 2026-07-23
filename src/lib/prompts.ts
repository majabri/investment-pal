// Prompt templates for ChatGPT morning + end-of-day reviews.
import { fmtPct, fmtUSD } from "./finance";

export type PromptContext = {
  portfolioValue: number;
  cash: number;
  marginUsed: number;
  buyingPower: number;
  todaysPL: number;
  todaysPLPct: number;
  goalTarget: number;
  goalDate: string;
  requiredCagr: number;
  probability: number;
  holdings: Array<{
    symbol: string;
    quantity: number;
    costBasis: number;
    currentPrice: number;
    thesis?: string | null;
  }>;
  priorities: string[];
  userNotes: string;
};

export function buildMorningPrompt(ctx: PromptContext): string {
  const holdingsBlock = ctx.holdings.length
    ? ctx.holdings
        .map(
          (h) =>
            `- ${h.symbol}: ${h.quantity} sh @ cost ${fmtUSD(h.costBasis, 2)}, last ${fmtUSD(h.currentPrice, 2)}${
              h.thesis ? ` — thesis: ${h.thesis}` : ""
            }`,
        )
        .join("\n")
    : "- (no holdings recorded)";

  return `You are my senior investment advisor. Prepare my Morning Review.

## Goal
Grow the Amir-TOD portfolio to ${fmtUSD(ctx.goalTarget)} by ${ctx.goalDate}.
Required CAGR: ${fmtPct(ctx.requiredCagr)}.
Current probability of reaching target (log-normal, moderate assumptions): ${fmtPct(ctx.probability)}.

## Portfolio snapshot
- Value: ${fmtUSD(ctx.portfolioValue)}
- Today's P/L: ${fmtUSD(ctx.todaysPL)} (${fmtPct(ctx.todaysPLPct)})
- Cash: ${fmtUSD(ctx.cash)}
- Margin used: ${fmtUSD(ctx.marginUsed)}
- Buying power: ${fmtUSD(ctx.buyingPower)}

## Holdings
${holdingsBlock}

## Today's priorities I already flagged
${ctx.priorities.length ? ctx.priorities.map((p) => `- ${p}`).join("\n") : "- (none)"}

## My notes
${ctx.userNotes || "(none)"}

## Please deliver
1. **What changed** since yesterday that matters to my portfolio and goal.
2. **What matters today** — earnings, macro events, technical levels.
3. **Recommended actions** grouped as Review / Buy Candidate / Hold / Reduce / Watch, each with a one-line rationale.
4. **Margin & risk check** — is my exposure appropriate given the setup?
5. **Goal-adjustment reality check** — does anything today move the probability meaningfully?

Be concise, evidence-based, and blunt. No filler.`;
}

export function buildEODPrompt(ctx: PromptContext & { tradesToday: string }): string {
  return `You are my senior investment advisor. Prepare my End-of-Day Review.

## Portfolio close
- Value: ${fmtUSD(ctx.portfolioValue)}
- Day P/L: ${fmtUSD(ctx.todaysPL)} (${fmtPct(ctx.todaysPLPct)})
- Cash: ${fmtUSD(ctx.cash)} | Margin used: ${fmtUSD(ctx.marginUsed)} | BP: ${fmtUSD(ctx.buyingPower)}

## Trades I made today
${ctx.tradesToday || "(none)"}

## My notes
${ctx.userNotes || "(none)"}

## Please deliver
1. **Scorecard** of today's decisions vs the morning plan.
2. **Lessons** — 1–3 concrete takeaways.
3. **Setup for tomorrow** — what to watch, what to prepare.
4. **Goal progress delta** — are we closer or further from the ${fmtUSD(ctx.goalTarget)} target?
5. **One thing I should stop doing / start doing**.

Be direct.`;
}

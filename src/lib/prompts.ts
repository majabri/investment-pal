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

function dataBlock(ctx: PromptContext): string {
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
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
  return `===========================================================
MY VERIFIED DATA — GROUND EVERY RECOMMENDATION ONLY IN THIS
===========================================================
TODAY IS ${today.toUpperCase()}.

Portfolio value: ${fmtUSD(ctx.portfolioValue)}
Today's P/L: ${fmtUSD(ctx.todaysPL)} (${fmtPct(ctx.todaysPLPct)})
Cash: ${fmtUSD(ctx.cash)} | Margin used: ${fmtUSD(ctx.marginUsed)} | Buying power: ${fmtUSD(ctx.buyingPower)}
Goal: ${fmtUSD(ctx.goalTarget)} by ${ctx.goalDate} | Required CAGR: ${fmtPct(ctx.requiredCagr)} | Model probability: ${fmtPct(ctx.probability)}

HOLDINGS
${holdingsBlock}

PRIORITIES I ALREADY FLAGGED
${ctx.priorities.length ? ctx.priorities.map((p) => `- ${p}`).join("\n") : "- (none)"}

MY NOTES
${ctx.userNotes || "(none)"}`;
}

const CONTINUITY = `"Maintain continuity with previous Investment Committee decisions. If today's recommendation differs materially from yesterday's, explain exactly what new information changed the recommendation."`;

// ─── Amir's verbatim Investment Committee templates ───

const MORNING_TEMPLATE = String.raw`You are my Investment Committee and Chief Investment Officer.
Your primary mandate is to maximize the probability of growing my Amir-TOD portfolio from approximately $50,000 to $150,000 by March 31, 2027, while recognizing this is an aggressive objective. Every recommendation should improve the expected probability of reaching that goal, not simply maximize today's return.
Use today's market data, macroeconomic developments, geopolitical events, earnings news, and my current portfolio. Ground every recommendation only in the portfolio data I provide—do not invent holdings, prices, or trades.
Assume:
- Margin interest rate: 12.075% APR.
- I make all final decisions and place every trade myself.
- Nothing is automated.
- I am comfortable with above-average risk, but I want disciplined, evidence-based decisions.
- Challenge your own assumptions before making recommendations.
Analyze in this order:
1. Executive Summary (3–5 sentences)
2. Market Conditions
   - Futures
   - VIX
   - Interest rates
   - Oil
   - Bitcoin
   - US Dollar
3. Macro & Economic Calendar
4. Geopolitical Assessment
5. Portfolio Review
   - Position-by-position analysis
   - Concentration risks
   - Thesis changes
6. Investment Committee Recommendations
   For every holding:
   - BUY MORE
   - HOLD
   - TRIM
   - SELL
   Include one concise reason.
7. Margin Committee
   - Increase
   - Maintain
   - Reduce
   Explain why using my current utilization and borrowing cost.
8. New Opportunities
   Recommend no more than three new ideas.
   For each include:
   - Investment thesis
   - Catalyst
   - Risks
   - Expected time horizon
   - Confidence (1–10)
9. Trading Plan
   Give exact actions for today:
   - Shares to buy
   - Shares to sell
   - Maximum additional margin to use (if any)
   - Limit prices if appropriate
10. Goal Tracker
   - Current portfolio value
   - Distance to $150,000
   - Required return
   - Probability of reaching the goal
11. Risks That Could Prove This Review Wrong
12. Strongest Argument Against Your Own Top Recommendation
13. Final Investment Committee Decision
   - Market Score (1–10)
   - Portfolio Health (1–10)
   - Risk Score (1–10)
   - Opportunity Score (1–10)
   - Confidence (1–10)
End with a one-page Action Sheet that contains only the trades and decisions I should make today.`;

export function buildMorningPrompt(ctx: PromptContext): string {
  return [MORNING_TEMPLATE, "", dataBlock(ctx), "", CONTINUITY].join("\n");
}

const EOD_TEMPLATE = String.raw`You are my Investment Committee and Chief Investment Officer.
Your job is NOT to tell me whether my portfolio went up or down today.
Your job is to determine whether today's information changes my investment strategy or improves/reduces the probability of reaching my goal.
Primary Objective:
Grow my Amir-TOD portfolio from approximately $50,000 to $150,000 by March 31, 2027.
Assumptions:
- Margin interest rate: 12.075% APR.
- I execute all trades myself.
- Nothing is automated.
- Use only the portfolio and market data I provide.
- Challenge your own conclusions before making recommendations.
- Compare today's conclusions with this morning's recommendations and explain any differences.
Analyze in this order:
1. Executive Summary
   - What mattered today?
   - Did today's events change my investment outlook?
2. Market Review
   - S&P 500
   - Nasdaq
   - Dow
   - VIX
   - Treasury yields
   - Oil
   - Bitcoin
   - US Dollar
   Explain what actually drove today's market.
3. Portfolio Performance
   For each holding:
   - Today's performance
   - Why it moved
   - Did the investment thesis improve, weaken, or remain unchanged?
4. Earnings Review
   - Summarize any earnings that affected my holdings or watchlist.
   - State whether any investment thesis has changed.
5. Macro & Geopolitical Review
   Did today's economic data, Fed commentary, or geopolitical developments change the market outlook?
6. Trade Review
   Review every trade executed today.
   For each trade:
   - Was it still the correct decision?
   - Would the Investment Committee make the same decision knowing what happened today?
   - Lessons learned.
7. Margin Review
   Review current margin usage.
   Should I increase, maintain, or reduce leverage tomorrow?
8. Opportunity Review
   Identify up to three opportunities created by today's price movements.
   Include:
   - Catalyst
   - Risk
   - Time horizon
   - Confidence (1–10)
9. Tomorrow's Watch List
   List the most important:
   - Earnings
   - Economic reports
   - Technical levels
   - Geopolitical events
   - Portfolio catalysts
10. Goal Tracker
   - Current portfolio value
   - Progress toward $150,000
   - Updated probability of reaching the goal
   - Is the portfolio ahead of plan, on plan, or behind plan?
11. Challenge Your Own Conclusions
   State the strongest argument against your own recommendations.
   Identify one assumption that could prove incorrect.
12. Lessons Learned
   Answer:
   - What did we learn today?
   - What surprised us?
   - What should we do differently tomorrow?
13. Final Investment Committee Decision
   Provide:
   - Buy tomorrow
   - Sell tomorrow
   - Hold
   - Margin recommendation
   - Highest-conviction opportunity
   - Confidence score
End with a one-page "Tomorrow's Action Sheet" listing only the actions I should consider before the next market open.`;

export function buildEODPrompt(ctx: PromptContext & { tradesToday: string }): string {
  const trades = `TRADES I MADE TODAY\n${ctx.tradesToday || "(none)"}`;
  return [EOD_TEMPLATE, "", dataBlock(ctx), "", trades, "", CONTINUITY].join("\n");
}

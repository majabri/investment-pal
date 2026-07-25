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
- Margin interest rate: 11.825% APR (Fidelity, verified 2026-07-24).
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
- Margin interest rate: 11.825% APR (Fidelity, verified 2026-07-24).
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

const WEEKLY_TEMPLATE = String.raw`You are my Investment Committee, Chief Investment Officer (CIO), Chief Risk Officer (CRO), and Devil's Advocate.
Your responsibility is to evaluate my portfolio exactly as an institutional investment committee would.
Your mission is NOT to maximize next week's return.
Your mission is to maximize the probability of growing my Amir-TOD portfolio from approximately $50,000 to $150,000 by March 31, 2027, while managing downside risk and using leverage intelligently.
Assumptions
• Target Portfolio Value: $150,000 by March 31, 2027
• Margin Interest Rate: 12.075% APR
• I execute all trades myself.
• Nothing is automated.
• Use only the portfolio and market data I provide.
• Challenge every recommendation before concluding.
• If your recommendation changes materially from last week's review, explain exactly what changed.
Return the report in this order.
===========================================================
1. Executive Investment Committee Summary
===========================================================
In 5–10 sentences answer:
• Are we ahead, on track, or behind plan?
• Has our probability of reaching the goal changed?
• What is the single biggest opportunity?
• What is the single biggest risk?
• What is the committee's overall recommendation?
===========================================================
2. Portfolio Scorecard
===========================================================
Provide:
Current Value
Weekly Return
Monthly Return
YTD Return
Cash
Margin Balance
Margin Utilization
Daily Interest
Portfolio Concentration
Largest Position
Goal Progress
Probability of Goal
Required CAGR
Portfolio Health Score (1–10)
===========================================================
3. Portfolio Review
===========================================================
For every holding provide:
Current Thesis
Has thesis strengthened?
Has thesis weakened?
Valuation
Catalysts
Risks
Recommendation:
BUY MORE
HOLD
TRIM
SELL
Confidence (1–10)
Flag positions that are:
Overweight
Underweight
No longer fit the strategy
===========================================================
4. Asset Allocation Review
===========================================================
Analyze:
Technology %
AI %
Semiconductors %
Software %
Cybersecurity %
Cash %
Margin %
Diversification
Concentration Risk
Recommend target allocations.
===========================================================
5. Margin Committee
===========================================================
Analyze:
Current borrowing cost
Current utilization
Risk
Expected return on leverage
Should leverage be:
Increase
Maintain
Reduce
Maximum recommended leverage for next week.
===========================================================
6. Market & Macro Review
===========================================================
Review:
Federal Reserve
Inflation
Interest rates
Employment
GDP
Oil
US Dollar
Bond Market
Credit Markets
AI spending
Cloud spending
Enterprise software
Consumer spending
Summarize how these affect my portfolio.
===========================================================
7. Geopolitical Review
===========================================================
Review only developments that matter for markets.
Examples:
Middle East
China
Taiwan
Russia
Trade
Tariffs
Energy
Semiconductors
Rank each:
Low
Medium
High
Explain portfolio impact.
===========================================================
8. Earnings Review
===========================================================
Review:
Portfolio earnings
Watchlist earnings
Guidance
AI Capex
Cloud Growth
Enterprise Software
Hyperscaler spending
Explain whether any investment thesis changed.
===========================================================
9. Opportunity Review
===========================================================
Recommend the five best opportunities.
For each provide:
Investment thesis
Catalyst
Expected upside
Risk
Time horizon
Confidence (1–10)
Separate into:
Long-term investments
Swing trades
High-conviction ideas
===========================================================
10. Risk Committee
===========================================================
Identify:
Top 10 portfolio risks
Probability
Impact
Mitigation
Stress-test the portfolio under:
10% market correction
20% market correction
Recession
AI slowdown
Higher interest rates
Geopolitical shock
===========================================================
11. Tax Strategy Committee
===========================================================
Review:
Realized gains
Realized losses
Unrealized gains
Unrealized losses
Tax-loss harvesting opportunities
Year-end planning
Recommend whether any tax actions should be considered.
===========================================================
12. Devil's Advocate
===========================================================
Assume the committee is wrong.
Present the strongest argument against the current portfolio.
Identify:
The weakest thesis
The most overvalued position
The greatest macro risk
The biggest blind spot
The decision we may regret most.
===========================================================
13. Investment Committee Vote
===========================================================
Each member votes independently.
Chief Investment Officer
Chief Risk Officer
Macro Strategist
Technology Analyst
Devil's Advocate
For each provide:
Buy
Hold
Reduce
Confidence
Summarize disagreements.
===========================================================
14. Decisions for Next Week
===========================================================
Provide exact actions.
For every trade include:
Stock
BUY / SELL
Shares
Maximum buy price
Minimum sell price
Reason
Priority
High
Medium
Low
===========================================================
15. Goal Tracker
===========================================================
Current Portfolio
Target
Remaining Gap
Required Return
Expected Return
Probability of Success
Biggest Obstacle
Biggest Opportunity
===========================================================
16. One-Page Weekly Action Sheet
===========================================================
End with a single-page summary containing only:
• Stocks to Buy
• Stocks to Sell
• Stocks to Hold
• Margin Decision
• Biggest Risk
• Biggest Opportunity
• Upcoming Catalysts
• Priority Actions for the Week
• Overall Confidence Score
Do not recommend trades simply to be active. If the best decision is to make no changes, state that clearly and explain why. Focus on maximizing the probability of reaching the March 31, 2027 goal through disciplined, high-conviction decisions rather than frequent trading.`;

export function buildWeeklyPrompt(ctx: PromptContext): string {
  return [WEEKLY_TEMPLATE, "", dataBlock(ctx), "", CONTINUITY].join("\n");
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app/AppShell";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  useGoal,
  useScopedHoldings,
  useScopedAccount,
  usePriorities,
  useAddJournal,
  useIpsLite,
  useUniverse,
} from "@/hooks/useAppData";
import {
  requiredCAGR,
  yearsBetween,
  probabilityOfReachingTarget,
  riskToVol,
  riskToExpectedReturn,
} from "@/lib/finance";
import { buildV6Prompt, type MeetingType, type PromptContext } from "@/lib/prompts";
import { goalAgreement, goalOnScreen, goalVersionLine } from "@/lib/goalAgreement";
import { quoteBanner } from "@/lib/quoteProvenance";
import { useAccountContext, useAccountScope } from "@/contexts/AccountContext";
import { AccountNotice } from "@/components/app/AccountNotice";
import { scorecardByAction, formatScorecardLines } from "@/lib/committeeScorecard";
import { useQuery } from "@tanstack/react-query";
import { getNewsFn } from "@/lib/newsServer";
import { useWatchlist } from "@/hooks/useAppData";
import { getEarningsCalendarFn, getEconCalendarFn } from "@/lib/calendarServer";
import { useJournal } from "@/hooks/useAppData";
import { getQuotesFn } from "@/lib/marketServer";
import { supabase } from "@/lib/supabaseClient";
import { localIsoDate } from "@/lib/localDate";
import { CommitteeChat } from "@/components/app/CommitteeChat";
import { useRecordCommitteeDecisions } from "@/hooks/useCommittee";
import { gateState } from "@/lib/readinessGate";
import { ipsVersionOf } from "@/lib/committeeDecisions";
import { PROMPT_VERSION, type CommitteeOutput } from "@/lib/committeeContract";
import { objectiveOf } from "@/lib/objective";
import { accountTotals } from "@/lib/accountTotals";
import { coverageOf } from "@/lib/coverage";
import { useReadiness } from "@/hooks/useReadiness";
import { ReadinessPanel } from "@/components/app/ReadinessPanel";

export const Route = createFileRoute("/_authenticated/prompt-center")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: "morning" | "midday" | "evening" | "weekly" | "monthly" } => ({
    tab: ["morning", "midday", "evening", "weekly", "monthly"].includes(search.tab as string)
      ? (search.tab as "morning" | "midday" | "evening" | "weekly" | "monthly")
      : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Committee — Investment Companion" },
      { name: "description", content: "Run your committee reviews in the app and record the decisions." },
    ],
  }),
  component: PromptCenter,
});

function PromptCenter() {
  const { data: goal, latestVersionId: goalVersionId, history: goalHistory } = useGoal();
  const { selectedAccount, status: accountStatus } = useAccountContext();
  // The prompt describes one account to the committee. `useAccount()` — the
  // household aggregate — was read here and passed into the memo's dependency
  // list, so a change to any other account's cash re-rendered this prompt.
  const scope = useAccountScope();
  const { data: scopedHoldings } = useScopedHoldings(scope, { includeUnassigned: true });
  const { data: balance } = useScopedAccount(scope);
  const { data: priorities = [] } = usePriorities();
  const { data: ipsLite } = useIpsLite();
  const { data: universe = [] } = useUniverse();
  // The user's stored watchlist. Twelve tickers were a literal here — one
  // household's list, compiled into every user's committee brief (CONST-006).
  const { data: watchlistRows = [] } = useWatchlist();
  // The readiness gate (Phase 5, rule 17). This screen's output is a brief
  // that asks a model to recommend against a real account, so it is gated on
  // the inputs that recommendation would rest on. Nothing else on the screen
  // is gated, and no other screen is.
  const readinessTotals = useMemo(
    () => accountTotals(scopedHoldings ?? [], balance ?? null),
    [scopedHoldings, balance],
  );
  const readiness = useReadiness(readinessTotals);
  const addJournal = useAddJournal();
  const { data: journalEntries = [] } = useJournal("");
  const newsSymbols = [...new Set(scopedHoldings.map((h) => h.symbol))].sort();
  const newsQuery = useQuery({
    queryKey: ["news", newsSymbols.join(",")],
    queryFn: () => getNewsFn({ data: { symbols: newsSymbols } }),
    staleTime: 10 * 60 * 1000,
  });
  const news = newsQuery.data ?? [];
  // Rule 30: whether the source was READ, not just what it returned. `- (none)`
  // reached the model as a fact about the market when the fetch had failed.
  const headlinesCoverage = coverageOf(newsQuery);
  const { data: decisions = [] } = useQuery({
    queryKey: ["decisions-for-prompt"],
    queryFn: async () => {
      const { data } = await supabase
        .from("decisions")
        .select("decided_on,symbol,recommendation,decision,outcome_pl")
        .order("decided_on", { ascending: false })
        .limit(10);
      return (data ?? []) as unknown as {
        decided_on: string;
        symbol: string | null;
        recommendation: string;
        decision: string;
        outcome_pl: number | null;
      }[];
    },
  });
  // Committee scorecard: graded track record by action type (migration item 4).
  const { data: scorecardRows = [] } = useQuery({
    queryKey: ["decisions-scorecard"],
    queryFn: async () => {
      const { data } = await supabase
        .from("decisions")
        .select("action,recommendation,grade,outcome_1m")
        .in("grade", ["CORRECT", "WRONG"])
        .limit(200);
      return (data ?? []) as unknown as {
        action: string | null;
        recommendation: string;
        grade: "CORRECT" | "WRONG" | "NEUTRAL" | "PENDING" | null;
        outcome_1m: number | null;
      }[];
    },
  });
  const committeeScorecard = useMemo(
    () => formatScorecardLines(scorecardByAction(scorecardRows)),
    [scorecardRows],
  );

  const [userNotes, setUserNotes] = useState("");
  const [tradesToday, setTradesToday] = useState("");
  const recordDecisions = useRecordCommitteeDecisions();
  const { tab: urlTab } = Route.useSearch();
  const [tab, setTab] = useState<string>(urlTab ?? "morning");
  useEffect(() => {
    if (urlTab) setTab(urlTab);
  }, [urlTab]);

  const { data: liveQuotes } = useQuery({
    queryKey: ["pc-quotes", scopedHoldings.map((h) => h.symbol).join(",")],
    queryFn: () => getQuotesFn({ data: { symbols: scopedHoldings.map((h) => h.symbol) } }),
    enabled: scopedHoldings.length > 0,
    refetchInterval: 60 * 1000,
  });
  const { data: liveEconCal = [] } = useQuery({
    queryKey: ["econ-cal-pc"],
    queryFn: () => getEconCalendarFn({ data: { days: 7 } }),
    refetchInterval: 60 * 60 * 1000,
  });
  const { data: liveEarnCal = [] } = useQuery({
    queryKey: [
      "earn-cal-pc",
      scopedHoldings.map((h) => h.symbol).join(","),
      universe.map((u) => u.symbol).join(","),
    ],
    queryFn: () =>
      getEarningsCalendarFn({
        data: {
          // The holdings, plus the user's own stored universe. Six tickers
          // were hardcoded here — one household's watchlist, compiled into the
          // application and appended to every user's earnings lookup. Missed
          // in the Phase 4 sweep because they are an argument to a fetch
          // rather than a named constant (rules 16, 37).
          symbols: [
            ...new Set([
              ...scopedHoldings.map((h) => h.symbol),
              ...universe.map((u) => u.symbol),
            ]),
          ],
          days: 7,
        },
      }),
    // The universe alone is enough to ask about; it used to require holdings
    // because the six hardcoded tickers were only ever a supplement to them.
    enabled: scopedHoldings.length + universe.length > 0,
    refetchInterval: 60 * 60 * 1000,
  });
  const ctx: PromptContext = useMemo(() => {
    const holdings = scopedHoldings.map((h) =>
      liveQuotes?.[h.symbol] ? { ...h, current_price: liveQuotes[h.symbol].price } : h,
    );
    // One engine (Phase 3a, rule 9). This was the fourth copy of
    // `positions + cash − debt`, and the one whose output goes to the model.
    const t = accountTotals(holdings, balance);
    const positionsValue = t.positionsValue;
    const cost = t.costBasis;
    const pl = t.unrealizedPL;
    // NULL, never 0. These go into the block headed "MY VERIFIED DATA —
    // GROUND EVERY RECOMMENDATION ONLY IN THIS", so a fabricated $0.00 is a
    // false premise the committee is instructed to reason from (Phase 1a).
    const cash = t.cash;
    const marginUsed = t.marginDebit;
    const grossValue = t.grossValue;
    const portfolioValue = t.totalAccountValue;
    const dayPL = holdings.reduce((sum, h) => {
      const q = liveQuotes?.[h.symbol];
      return q && q.prevClose > 0 ? sum + h.quantity * (q.price - q.prevClose) : sum;
    }, 0);
    // An unset objective produces no required CAGR and no probability. These
    // used to fall back to 0, which reads as "no growth required" and "no
    // chance of success" — two confident claims made from missing data.
    const objective = objectiveOf(goal);
    const years =
      objective.kind === "set"
        ? Math.max(yearsBetween(new Date(), new Date(objective.targetDate)), 0.01)
        : null;
    // `portfolioValue || objective.startingValue` fell back to the objective's
    // own starting value when the account value was unknown — reporting the
    // pace required the day the goal was written as though it were today's.
    const cagr =
      objective.kind === "set" && years !== null && portfolioValue !== null
        ? requiredCAGR(
            // `||` treats a real 0 as missing and silently projects from the
            // objective's own starting value instead. `> 0` matches the pattern
            // the dashboard and the goal screen already use (Copilot, #141).
            portfolioValue > 0 ? portfolioValue : objective.startingValue,
            objective.targetValue,
            years,
          )
        : null;
    const prob =
      objective.kind === "set" && years !== null && goal && portfolioValue !== null
        ? probabilityOfReachingTarget(
            portfolioValue > 0 ? portfolioValue : objective.startingValue,
            objective.targetValue,
            years,
            riskToExpectedReturn(goal.risk_preference),
            riskToVol(goal.risk_preference),
          )
        : null;
    return {
      portfolioValue,
      grossValue,
      cash,
      marginUsed,
      buyingPower:
        selectedAccount?.buying_power === null || selectedAccount?.buying_power === undefined
          ? null
          : Number(selectedAccount.buying_power),
      todaysPL: dayPL,
      todaysPLPct:
        portfolioValue !== null && portfolioValue - dayPL > 0
          ? dayPL / (portfolioValue - dayPL)
          : null,
      accountName: goal?.name?.trim() || selectedAccount?.name || "this portfolio",
      // `objectiveOf`'s answer, carried whole. This used to be three fields
      // filled with `?? 0` and `?? "—"`, which the mandate then handed to the
      // committee as "from approximately $0 to $0 by —" (Copilot, #138).
      objective,
      requiredCagr: cagr,
      probability: prob,
      // GOAL-001: whether the goal the brief reads is the goal the decision
      // will cite. The stamp below carries `goalVersionId`; this line tells
      // the model when the row behind that id and the goal above disagree.
      goalVersionLine: goalVersionLine(goalAgreement(goalOnScreen(goal ?? null), goalHistory)),
      ipsPositionCapPct: ipsLite.position_cap_pct,
      ipsPositionCapHard: ipsLite.position_cap_hard,
      ipsMarginCapPct: ipsLite.margin_cap_pct,
      // Rule 15: the caps travel with where they came from, so the prompt can
      // say whether they are the user's decision or the app's default.
      ipsCapsSource: ipsLite.caps_source,
      // Rule 17: the brief carries the gate's verdict, so the model is told
      // what could not be verified rather than reasoning past it.
      readiness,
      marginPolicy: ipsLite,
      holdings: holdings.map((h) => ({
        symbol: h.symbol,
        quantity: h.quantity,
        costBasis: h.cost_basis,
        currentPrice: h.current_price,
        thesis: h.current_thesis ?? h.original_thesis,
      })),
      priorities: priorities.map((p) => p.label),
      userNotes,
      watchlist: watchlistRows.map((w) => w.symbol),
      upcomingEarnings: liveEarnCal.map(
        (e) =>
          `${e.date} ${e.symbol} (${e.session === "bmo" ? "pre-market" : "after close"})${scopedHoldings.some((h) => h.symbol === e.symbol) ? " — HELD" : ""}`,
      ),
      upcomingEcon: liveEconCal
        .filter((e) => e.importance !== "low")
        .map(
          (e) => `${e.date} ${e.name} [${e.importance}]${e.consensus ? ` est ${e.consensus}` : ""}`,
        ),
      topHeadlines: news.slice(0, 6).map((n) => `${n.title} (${n.source})`),
      headlinesCoverage,
      // §B.2 / CONST-004: the model is told where the prices came from and
      // how current they are, in the same block as the prices.
      quoteProvenanceLine:
        quoteBanner(liveQuotes) ??
        "Quotes: none retrieved for this brief — the prices below are the last stored ones, and their age is per holding.",
      recentDecisions: decisions.map(
        (d) =>
          `${d.decided_on}${d.symbol ? ` ${d.symbol}` : ""}: "${d.recommendation}" → ${d.decision}${d.outcome_pl != null ? ` → ${d.outcome_pl >= 0 ? "+" : ""}$${d.outcome_pl.toFixed(2)}` : ""}`,
      ),
      recentJournal: journalEntries
        .slice(0, 3)
        .map((j) => `${j.created_at.slice(0, 10)}: ${(j.title ?? j.body ?? "").slice(0, 120)}`),
      committeeScorecard,
    };
  }, [
    scopedHoldings,
    liveQuotes,
    selectedAccount,
    balance,
    goal,
    goalHistory,
    priorities,
    ipsLite,
    userNotes,
    news,
    journalEntries,
    decisions,
    committeeScorecard,
    liveEconCal,
    liveEarnCal,
    readiness,
    headlinesCoverage,
    watchlistRows,
  ]);

  const MEETING: Record<string, MeetingType> = {
    morning: "Morning",
    midday: "Mid-Day",
    evening: "Evening",
    weekly: "Weekly",
    monthly: "Monthly",
  };
  const prompt = buildV6Prompt({ ...ctx, meeting: MEETING[tab] ?? "Morning", tradesToday });

  // DEC-004: the gate's verdict travels with the review. BLOCKED refuses the
  // record; DEGRADED records with the caveat as each decision's first risk.
  const verdict = useMemo(() => gateState("committee_recommendation", readiness), [readiness]);
  const meeting: MeetingType = MEETING[tab] ?? "Morning";

  const recordActionSheet = async (output: CommitteeOutput, modelVersion: string | null) => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      toast.error("Not signed in");
      return;
    }
    const stamp = {
      userId: auth.user.id,
      today: localIsoDate(),
      meeting,
      goalVersionId,
      ipsVersion: ipsVersionOf(ipsLite),
      modelVersion,
      promptVersion: PROMPT_VERSION,
      verdict,
      quotes: liveQuotes ?? {},
    };
    try {
      const n = await recordDecisions.mutateAsync({ output, stamp });
      toast.success(
        `${n} decision${n === 1 ? "" : "s"} recorded as pending. Dispose of them on the Decisions page.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the decisions");
    }
  };

  const saveTranscript = (transcript: string) => {
    addJournal.mutate(
      {
        entry_type: tab === "morning" ? "morning_review" : "eod_review",
        title: `${meeting} committee — ${new Date().toLocaleDateString()}`,
        body: prompt,
        ai_summary: transcript,
      },
      {
        onSuccess: () => toast.success("Transcript saved to Journal"),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  return (
    <AppShell
      title="Committee"
      subtitle="Run the review with the committee, decide, and record the decisions."
    >
      <AccountNotice status={accountStatus} />
      <ReadinessPanel
        checks={readiness}
        capability="committee_recommendation"
        what="a committee brief for this account"
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="morning">Morning</TabsTrigger>
          <TabsTrigger value="midday">Mid-Day</TabsTrigger>
          <TabsTrigger value="evening">Evening</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
        </TabsList>

        <TabsContent value="morning" className="mt-4 space-y-4">
          <NotesCard notes={userNotes} setNotes={setUserNotes} />
        </TabsContent>

        <TabsContent value="evening" className="mt-4 space-y-4">
          <div className="rounded-2xl border bg-card p-5">
            <div className="mb-2 text-sm font-medium">Trades I made today</div>
            <Textarea
              rows={4}
              value={tradesToday}
              onChange={(e) => setTradesToday(e.target.value)}
              placeholder="e.g., Bought 20 NVDA @ 480, trimmed 10 AAPL @ 225…"
            />
          </div>
          <NotesCard notes={userNotes} setNotes={setUserNotes} />
        </TabsContent>
        <TabsContent value="midday" className="mt-4 space-y-4">
          <NotesCard notes={userNotes} setNotes={setUserNotes} />
        </TabsContent>
        <TabsContent value="weekly" className="mt-4 space-y-4">
          <NotesCard notes={userNotes} setNotes={setUserNotes} />
        </TabsContent>
        <TabsContent value="monthly" className="mt-4 space-y-4">
          <NotesCard notes={userNotes} setNotes={setUserNotes} />
        </TabsContent>
      </Tabs>
      <div className="mt-6">
        {/* Keyed by meeting: a different brief is a different conversation. */}
        <CommitteeChat
          key={tab}
          systemPrompt={prompt}
          meeting={meeting}
          verdict={verdict}
          onRecord={recordActionSheet}
          onSaveTranscript={saveTranscript}
          recording={recordDecisions.isPending}
        />
      </div>
      <details className="mt-4 rounded-2xl border bg-card p-5">
        <summary className="cursor-pointer text-sm font-medium">
          The brief the committee received
        </summary>
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 text-xs leading-relaxed text-foreground/90">
          {prompt}
        </pre>
      </details>
    </AppShell>
  );
}

function NotesCard({ notes, setNotes }: { notes: string; setNotes: (v: string) => void }) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="mb-2 text-sm font-medium">My notes / questions for the committee</div>
      <Textarea
        id="committee-notes"
        rows={4}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything you want the committee to consider today…"
      />
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  useGoal,
  useHoldings,
  useAccount,
  usePriorities,
  useAddJournal,
} from "@/hooks/useAppData";
import {
  requiredCAGR,
  yearsBetween,
  probabilityOfReachingTarget,
  riskToVol,
  riskToExpectedReturn,
} from "@/lib/finance";
import { buildV5Prompt, type MeetingType, type PromptContext } from "@/lib/prompts";
import { useQuery } from "@tanstack/react-query";
import { getNewsFn } from "@/lib/newsServer";
import { getEarningsCalendarFn, getEconCalendarFn } from "@/lib/calendarServer";
import { useJournal, useAccounts } from "@/hooks/useAppData";
import { getQuotesFn } from "@/lib/marketServer";
import { supabase } from "@/integrations/supabase/client";
import { CommitteeChat } from "@/components/app/CommitteeChat";

export const Route = createFileRoute("/_authenticated/prompt-center")({
  validateSearch: (search: Record<string, unknown>): { tab?: "morning" | "midday" | "evening" | "weekly" | "monthly" } => ({
    tab: ["morning", "midday", "evening", "weekly", "monthly"].includes(search.tab as string)
      ? (search.tab as "morning" | "midday" | "evening" | "weekly" | "monthly") : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Prompt Center — Investment Companion" },
      { name: "description", content: "Build your Morning and End-of-Day ChatGPT prompts." },
    ],
  }),
  component: PromptCenter,
});

function PromptCenter() {
  const { data: goal } = useGoal();
  const { data: allHoldings = [] } = useHoldings();
  const { data: account } = useAccount();
  const { data: accountsList = [] } = useAccounts();
  const amirAccount = accountsList.find((a) => a.name === "Amir - TOD");
  const { data: priorities = [] } = usePriorities();
  const addJournal = useAddJournal();
  const { data: journalEntries = [] } = useJournal("");
  const { data: news = [] } = useQuery({ queryKey: ["news"], queryFn: () => getNewsFn(), staleTime: 10 * 60 * 1000 });
  const { data: decisions = [] } = useQuery({
    queryKey: ["decisions-for-prompt"],
    queryFn: async () => {
      const { data } = await supabase.from("decisions" as never)
        .select("decided_on,symbol,recommendation,decision,outcome_pl")
        .order("decided_on", { ascending: false }).limit(10);
      return (data ?? []) as unknown as { decided_on: string; symbol: string | null; recommendation: string; decision: string; outcome_pl: number | null }[];
    },
  });

  const [userNotes, setUserNotes] = useState("");
  const [tradesToday, setTradesToday] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const { tab: urlTab } = Route.useSearch();
  const [tab, setTab] = useState<string>(urlTab ?? "morning");
  useEffect(() => { if (urlTab) setTab(urlTab); }, [urlTab]);

  const amirHoldings = useMemo(() => amirAccount
    ? allHoldings.filter((h) => h.account_id === amirAccount.id || h.account_id == null)
    : allHoldings.filter((h) => h.account_id == null), [allHoldings, amirAccount]);
  const { data: liveQuotes } = useQuery({
    queryKey: ["pc-quotes", amirHoldings.map((h) => h.symbol).join(",")],
    queryFn: () => getQuotesFn({ data: { symbols: amirHoldings.map((h) => h.symbol) } }),
    enabled: amirHoldings.length > 0,
    refetchInterval: 60 * 1000,
  });
  const { data: liveEconCal = [] } = useQuery({
    queryKey: ["econ-cal-pc"], queryFn: () => getEconCalendarFn({ data: { days: 7 } }),
    refetchInterval: 60 * 60 * 1000,
  });
  const { data: liveEarnCal = [] } = useQuery({
    queryKey: ["earn-cal-pc", amirHoldings.map((h) => h.symbol).join(",")],
    queryFn: () => getEarningsCalendarFn({ data: { symbols: [...amirHoldings.map((h) => h.symbol), "NVDA","META","COST","PANW","TSM","AAPL"], days: 7 } }),
    enabled: amirHoldings.length > 0,
    refetchInterval: 60 * 60 * 1000,
  });
  const ctx: PromptContext = useMemo(() => {
    const holdings = amirHoldings.map((h) => liveQuotes?.[h.symbol]
      ? { ...h, current_price: liveQuotes[h.symbol].price } : h);
    const positionsValue = holdings.reduce((s, h) => s + h.quantity * h.current_price, 0);
    const cost = holdings.reduce((s, h) => s + h.quantity * h.cost_basis, 0);
    const pl = positionsValue - cost;
    const cash = Number(amirAccount?.cash ?? 0);
    const marginUsed = Number(amirAccount?.margin_used ?? 0);
    const grossValue = positionsValue + cash;
    const portfolioValue = grossValue - marginUsed; // NET — Fidelity's Total account value
    const dayPL = holdings.reduce((sum, h) => {
      const q = liveQuotes?.[h.symbol];
      return q && q.prevClose > 0 ? sum + h.quantity * (q.price - q.prevClose) : sum;
    }, 0);
    const today = new Date();
    const years = goal ? Math.max(yearsBetween(today, new Date(goal.target_date)), 0.01) : 1;
    const cagr = goal ? requiredCAGR(portfolioValue || goal.starting_value, goal.target_value, years) : 0;
    const prob = goal
      ? probabilityOfReachingTarget(
          portfolioValue || goal.starting_value,
          goal.target_value,
          years,
          riskToExpectedReturn(goal.risk_preference),
          riskToVol(goal.risk_preference),
        )
      : 0;
    return {
      portfolioValue,
      grossValue,
      cash,
      marginUsed,
      buyingPower: Number(amirAccount?.buying_power ?? 0),
      todaysPL: dayPL,
      todaysPLPct: portfolioValue - dayPL > 0 ? dayPL / (portfolioValue - dayPL) : 0,
      goalTarget: goal?.target_value ?? 0,
      goalDate: goal?.target_date ?? "—",
      requiredCagr: cagr,
      probability: prob,
      holdings: holdings.map((h) => ({
        symbol: h.symbol,
        quantity: h.quantity,
        costBasis: h.cost_basis,
        currentPrice: h.current_price,
        thesis: h.current_thesis ?? h.original_thesis,
      })),
      priorities: priorities.map((p) => p.label),
      userNotes,
      watchlist: ["NVDA","AVGO","TSM","AMD","META","COST","NFLX","NOW","PANW","MA","LLY","BRK.B"],
      upcomingEarnings: liveEarnCal.map((e) =>
        `${e.date} ${e.symbol} (${e.session === "bmo" ? "pre-market" : "after close"})${amirHoldings.some((h) => h.symbol === e.symbol) ? " — HELD" : ""}`),
      upcomingEcon: liveEconCal.filter((e) => e.importance !== "low")
        .map((e) => `${e.date} ${e.name} [${e.importance}]${e.consensus ? ` est ${e.consensus}` : ""}`),
      topHeadlines: news.slice(0, 6).map((n) => `${n.title} (${n.source})`),
      recentDecisions: decisions.map((d) =>
        `${d.decided_on}${d.symbol ? ` ${d.symbol}` : ""}: "${d.recommendation}" → ${d.decision}${d.outcome_pl != null ? ` → ${d.outcome_pl >= 0 ? "+" : ""}$${d.outcome_pl.toFixed(2)}` : ""}`),
      recentJournal: journalEntries.slice(0, 3).map((j) =>
        `${j.created_at.slice(0, 10)}: ${(j.title ?? j.body ?? "").slice(0, 120)}`),
    };
  }, [amirHoldings, liveQuotes, amirAccount, account, goal, priorities, userNotes, news, journalEntries, decisions, liveEconCal, liveEarnCal]);

  const MEETING: Record<string, MeetingType> = {
    morning: "Morning", midday: "Mid-Day", evening: "Evening", weekly: "Weekly", monthly: "Monthly",
  };
  const prompt = buildV5Prompt({ ...ctx, meeting: MEETING[tab] ?? "Morning", tradesToday });

  const copy = async () => {
    await navigator.clipboard.writeText(prompt);
    toast.success("Prompt copied");
  };
  const openChatGPT = () => window.open("https://chat.openai.com/", "_blank", "noopener");
  const saveSummary = () => {
    if (!aiResponse.trim()) return toast.error("Paste the AI response first");
    addJournal.mutate(
      {
        entry_type: tab === "morning" ? "morning_review" : "eod_review",
        title: `${tab === "morning" ? "Morning" : "EOD"} review — ${new Date().toLocaleDateString()}`,
        body: prompt,
        ai_summary: aiResponse,
      },
      {
        onSuccess: () => {
          toast.success("Saved to Journal");
          setAiResponse("");
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  return (
    <AppShell
      title="Prompt Center"
      subtitle="Build a complete review prompt, run it in ChatGPT, save the summary."
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="morning">Morning</TabsTrigger>
          <TabsTrigger value="midday">Mid-Day</TabsTrigger>
          <TabsTrigger value="evening">Evening</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
        </TabsList>

        <TabsContent value="morning" className="mt-4 space-y-4">
          <PromptEditor
            prompt={prompt}
            notes={userNotes}
            setNotes={setUserNotes}
            aiResponse={aiResponse}
            setAiResponse={setAiResponse}
            onCopy={copy}
            onOpen={openChatGPT}
            onSave={saveSummary}
          />
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
          <PromptEditor
            prompt={prompt}
            notes={userNotes}
            setNotes={setUserNotes}
            aiResponse={aiResponse}
            setAiResponse={setAiResponse}
            onCopy={copy}
            onOpen={openChatGPT}
            onSave={saveSummary}
          />
        </TabsContent>
        <TabsContent value="midday" className="mt-4 space-y-4">
          <PromptEditor
            prompt={prompt}
            notes={userNotes}
            setNotes={setUserNotes}
            aiResponse={aiResponse}
            setAiResponse={setAiResponse}
            onCopy={copy}
            onOpen={openChatGPT}
            onSave={saveSummary}
          />
        </TabsContent>
        <TabsContent value="weekly" className="mt-4 space-y-4">
          <PromptEditor
            prompt={prompt}
            notes={userNotes}
            setNotes={setUserNotes}
            aiResponse={aiResponse}
            setAiResponse={setAiResponse}
            onCopy={copy}
            onOpen={openChatGPT}
            onSave={saveSummary}
          />
        </TabsContent>
        <TabsContent value="monthly" className="mt-4 space-y-4">
          <PromptEditor
            prompt={prompt}
            notes={userNotes}
            setNotes={setUserNotes}
            aiResponse={aiResponse}
            setAiResponse={setAiResponse}
            onCopy={copy}
            onOpen={openChatGPT}
            onSave={saveSummary}
          />
        </TabsContent>
      </Tabs>
          <div className="mt-6">
        <CommitteeChat systemPrompt={prompt} title={`Investment Committee Chat — ${MEETING[tab] ?? "Morning"}`} />
      </div>
    </AppShell>
  );
}

function PromptEditor({
  prompt,
  notes,
  setNotes,
  aiResponse,
  setAiResponse,
  onCopy,
  onOpen,
  onSave,
}: {
  prompt: string;
  notes: string;
  setNotes: (v: string) => void;
  aiResponse: string;
  setAiResponse: (v: string) => void;
  onCopy: () => void;
  onOpen: () => void;
  onSave: () => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="rounded-2xl border bg-card p-5">
          <div className="mb-2 text-sm font-medium">My notes / questions for AI</div>
          <Textarea
            rows={5}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything you want ChatGPT to consider today…"
          />
        </div>
        <div className="rounded-2xl border bg-card p-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">Generated prompt</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={onCopy}>
                <Copy className="mr-2 h-4 w-4" /> Copy
              </Button>
              <Button size="sm" onClick={onOpen}>
                <ExternalLink className="mr-2 h-4 w-4" /> Open ChatGPT
              </Button>
            </div>
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 text-xs leading-relaxed text-foreground/90">
{prompt}
          </pre>
        </div>
      </div>
      <div className="rounded-2xl border bg-card p-5">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium">Paste AI summary</div>
          <Button size="sm" onClick={onSave}>
            <Save className="mr-2 h-4 w-4" /> Save to Journal
          </Button>
        </div>
        <Textarea
          rows={20}
          value={aiResponse}
          onChange={(e) => setAiResponse(e.target.value)}
          placeholder="Paste ChatGPT's response here to archive it in your Journal…"
        />
      </div>
    </div>
  );
}

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
import { buildMorningPrompt, buildEODPrompt, buildWeeklyPrompt, buildMiddayPrompt, type PromptContext } from "@/lib/prompts";
import { useQuery } from "@tanstack/react-query";
import { getNewsFn } from "@/lib/newsServer";
import { ECON_EVENTS, EARNINGS_EVENTS } from "@/lib/data/calendars";
import { useJournal } from "@/hooks/useAppData";
import { CommitteeChat } from "@/components/app/CommitteeChat";

export const Route = createFileRoute("/_authenticated/prompt-center")({
  validateSearch: (search: Record<string, unknown>): { tab?: "morning" | "eod" | "weekly" | "midday" } => ({
    tab: search.tab === "eod" || search.tab === "weekly" || search.tab === "morning" || search.tab === "midday"
      ? (search.tab as "morning" | "eod" | "weekly" | "midday") : undefined,
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
  const { data: holdings = [] } = useHoldings();
  const { data: account } = useAccount();
  const { data: priorities = [] } = usePriorities();
  const addJournal = useAddJournal();
  const { data: journalEntries = [] } = useJournal("");
  const { data: news = [] } = useQuery({ queryKey: ["news"], queryFn: () => getNewsFn(), staleTime: 10 * 60 * 1000 });

  const [userNotes, setUserNotes] = useState("");
  const [tradesToday, setTradesToday] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const { tab: urlTab } = Route.useSearch();
  const [tab, setTab] = useState<string>(urlTab ?? "morning");
  useEffect(() => { if (urlTab) setTab(urlTab); }, [urlTab]);

  const ctx: PromptContext = useMemo(() => {
    const positionsValue = holdings.reduce((s, h) => s + h.quantity * h.current_price, 0);
    const cost = holdings.reduce((s, h) => s + h.quantity * h.cost_basis, 0);
    const pl = positionsValue - cost;
    const cash = account?.cash ?? 0;
    const portfolioValue = positionsValue + cash;
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
      cash,
      marginUsed: account?.margin_used ?? 0,
      buyingPower: account?.buying_power ?? 0,
      todaysPL: pl,
      todaysPLPct: cost > 0 ? pl / cost : 0,
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
      upcomingEarnings: (() => {
        const t = new Date().toISOString().slice(0, 10);
        const wk = new Date(); wk.setDate(wk.getDate() + 7);
        const w = wk.toISOString().slice(0, 10);
        return EARNINGS_EVENTS.filter((e) => e.date >= t && e.date <= w)
          .map((e) => `${e.date} ${e.symbol} (${e.session === "bmo" ? "pre-market" : "after close"})${e.inPortfolio ? " — HELD" : ""}`);
      })(),
      upcomingEcon: (() => {
        const t = new Date().toISOString().slice(0, 10);
        const wk = new Date(); wk.setDate(wk.getDate() + 7);
        const w = wk.toISOString().slice(0, 10);
        return ECON_EVENTS.filter((e) => e.date >= t && e.date <= w).map((e) => `${e.date} ${e.name} [${e.importance}]`);
      })(),
      topHeadlines: news.slice(0, 6).map((n) => `${n.title} (${n.source})`),
      recentJournal: journalEntries.slice(0, 3).map((j) =>
        `${j.created_at.slice(0, 10)}: ${(j.title ?? j.content ?? "").slice(0, 120)}`),
    };
  }, [holdings, account, goal, priorities, userNotes, news, journalEntries]);

  const prompt = tab === "morning" ? buildMorningPrompt(ctx)
    : tab === "weekly" ? buildWeeklyPrompt(ctx)
    : tab === "midday" ? buildMiddayPrompt(ctx)
    : buildEODPrompt({ ...ctx, tradesToday });

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
          <TabsTrigger value="morning">
            <Sparkles className="mr-2 h-4 w-4" /> Morning review
          </TabsTrigger>
          <TabsTrigger value="midday">Midday update</TabsTrigger>
          <TabsTrigger value="eod">End-of-day review</TabsTrigger>
          <TabsTrigger value="weekly">Weekly committee</TabsTrigger>
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

        <TabsContent value="eod" className="mt-4 space-y-4">
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
      </Tabs>
          <div className="mt-6">
        <CommitteeChat systemPrompt={prompt} title={tab === "morning" ? "Investment Committee Chat — Morning" : tab === "weekly" ? "Weekly Institutional Committee Chat" : "Investment Committee Chat — End of Day"} />
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

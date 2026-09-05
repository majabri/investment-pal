// The Decisions surface.
//
// The evidence contract has been written to `public.decisions` since PR #63 and
// read by nothing: there was no route that displayed it, and Today's Plan
// selected only `id, recommendation, decision` — so the counterargument, the
// risks and the invalidation conditions sat unread in Postgres. That is the
// expensive half of a governed decision, already built and invisible.
//
// This page reads the contract columns and renders them through DecisionCard.
// It computes nothing about money: every value shown is a stored field.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/app/AppShell";
import { DecisionCard, type DecisionRow } from "@/components/app/DecisionCard";
import { supabase } from "@/lib/supabaseClient";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/decisions")({
  head: () => ({
    meta: [
      { title: "Decisions — Investment Companion" },
      {
        name: "description",
        content:
          "Governed committee decisions with their evidence, risks and invalidation conditions.",
      },
    ],
  }),
  component: DecisionsPage,
});

/**
 * Every contract column, named explicitly.
 *
 * `select("*")` would be shorter and wrong: a column added later would start
 * rendering here with nobody having decided it should.
 */
const CONTRACT_SELECT = [
  "id",
  "symbol",
  "recommendation",
  "decision",
  "decided_on",
  "action",
  "confidence",
  "evidence",
  "counterargument",
  "key_risks",
  "portfolio_impact",
  "probability_impact",
  "invalidation_conditions",
  "ips_version",
  "model_version",
  "prompt_version",
  "objective_id",
].join(",");

type Row = DecisionRow & { decided_on?: string | null };

function DecisionsPage() {
  const [q, setQ] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["decisions-all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("decisions" as never)
        .select(CONTRACT_SELECT)
        .order("decided_on", { ascending: false })
        .order("id", { ascending: true })
        .limit(200);
      return (data ?? []) as unknown as Row[];
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? rows.filter((r) =>
        [r.symbol, r.recommendation, r.decision].some((v) =>
          typeof v === "string" ? v.toLowerCase().includes(needle) : false,
        ),
      )
    : rows;

  // Group by decision date so the page reads as a history rather than a heap.
  const groups = new Map<string, Row[]>();
  for (const r of shown) {
    const key = r.decided_on ?? "Undated";
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  return (
    <AppShell
      title="Decisions"
      subtitle="Committee decisions with their evidence and invalidation conditions"
    >
      <div className="mb-4 max-w-sm">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by symbol or text"
          aria-label="Filter decisions"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading decisions…</p>
      ) : shown.length === 0 ? (
        // Empty must look empty (AIOS-UX-003) and must not imply that no
        // decisions were ever made when a filter is simply excluding them.
        <div className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
          {rows.length === 0
            ? "No decisions recorded yet. Run a committee review from the Prompt Center and log its output."
            : "No decisions match this filter."}
        </div>
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([date, list]) => (
            <section key={date}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {date}
              </h2>
              <div className="space-y-3">
                {list.map((r) => (
                  <DecisionCard key={r.id} row={r} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}

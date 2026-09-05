// The decision card (PR-UI-3, gap G2).
//
// The evidence contract has been written to `decisions` since PR #63 and read
// by nothing: Today's Plan showed `recommendation` as a bare sentence beside a
// coloured dot, while the counterargument, risks and invalidation conditions
// sat unread in Postgres. Those are what make this a governed decision rather
// than a tip, so they belong on the card.
//
// Two rules this component exists to hold:
//
//  1. Confidence and probability are never conflated. The migration is explicit
//     — confidence is how sure the reasoning is; probability_impact is the
//     effect on objective success. They are rendered in different places, in
//     different forms, with captions saying which is which. They never share a
//     row, a bar, or a number format.
//  2. Dissent is not de-emphasised. The counterargument gets the same visual
//     weight as the thesis. A bear case rendered as fine print is a bear case
//     the reader skips.
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  readDecisionEvidence,
  type DecisionEvidenceRow,
  type EvidenceItem,
  type ImpactEntry,
} from "@/lib/decisionEvidence";

export type DecisionRow = DecisionEvidenceRow & {
  id: string;
  recommendation: string;
  decision: string;
  symbol?: string | null;
};

/** Status text, never colour alone — the dot this replaces had no accessible name. */
const DECISION_LABEL: Record<string, string> = {
  pending: "Pending",
  followed: "Followed",
  modified: "Modified",
  rejected: "Rejected",
};

function decisionTone(decision: string): string {
  switch (decision) {
    case "followed":
      return "bg-success/15 text-success";
    case "rejected":
      return "bg-destructive/15 text-destructive";
    case "modified":
      return "bg-warning/15 text-warning";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {hint ? <div className="text-[11px] text-muted-foreground/80">{hint}</div> : null}
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

/** Explicit absence. Rows predating the evidence contract are all NULL, and a
 *  missing field must read as missing rather than as an empty claim — "not
 *  captured", never "no risks". The difference matters: one says nobody wrote
 *  it down, the other asserts there are none. */
function NotCaptured() {
  return <span className="text-sm text-muted-foreground">Not captured</span>;
}

function EvidenceList({ items }: { items: EvidenceItem[] }) {
  if (items.length === 0) return <NotCaptured />;
  return (
    <ul className="space-y-1">
      {items.map((e, i) => (
        <li key={`${e.claim}-${i}`} className="flex flex-col">
          <span>{e.claim}</span>
          {e.source ? (
            <span className="text-xs text-muted-foreground">Source: {e.source}</span>
          ) : (
            // Say so rather than implying the claim is sourced when it is not.
            <span className="text-xs text-muted-foreground/70">Source not recorded</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return <NotCaptured />;
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {items.map((s, i) => (
        <li key={`${s}-${i}`}>{s}</li>
      ))}
    </ul>
  );
}

function Impact({ entries }: { entries: ImpactEntry[] }) {
  if (entries.length === 0) return <NotCaptured />;
  return (
    <dl className="space-y-0.5">
      {entries.map((e, i) => (
        <div key={`${e.label}-${i}`} className="flex flex-wrap gap-x-2">
          {e.label ? <dt className="text-muted-foreground">{e.label}:</dt> : null}
          <dd className="tabular-nums">{e.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DecisionCard({ row }: { row: DecisionRow }) {
  const [open, setOpen] = useState(false);
  const ev = readDecisionEvidence(row);
  const status = DECISION_LABEL[row.decision] ?? row.decision;

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-start gap-2 px-4 py-3">
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
            decisionTone(row.decision),
          )}
        >
          {status}
        </span>
        {ev.action ? (
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
              ev.action.inContract
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
            )}
            // An action outside the contract enum is shown as written, not
            // mapped onto a contract word the committee never used.
            title={ev.action.inContract ? undefined : "Not one of the contract actions"}
          >
            {ev.action.value}
          </span>
        ) : null}
        {row.symbol ? <span className="text-sm font-semibold">{row.symbol}</span> : null}
        <span className="min-w-0 flex-1 text-sm">{row.recommendation}</span>
      </div>

      {/* Confidence lives here, alone, captioned. Probability is inside the
          expanded body under its own heading — deliberately never adjacent. */}
      {ev.confidence ? (
        <div className="flex items-baseline gap-2 border-t px-4 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Confidence
          </span>
          <span className="text-sm font-medium tabular-nums">{ev.confidence}</span>
          <span className="text-[11px] text-muted-foreground">
            how sure the reasoning is — not the odds of success
          </span>
        </div>
      ) : null}

      {ev.hasAny ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex w-full items-center gap-1 border-t px-4 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
          >
            {open ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {open ? "Hide reasoning" : "Why now · why this · what would make it wrong"}
          </button>

          {open ? (
            <div className="space-y-4 border-t px-4 py-3">
              {/* First and boxed, deliberately. Invalidation conditions are the
                  primary call to action: they are the thing re-read later to
                  decide whether the thesis broke. Everything else explains why
                  the decision was made; only this says when to revisit it. */}
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
                <Section
                  title="What would make this wrong"
                  hint="check these before acting on this decision again"
                >
                  <Bullets items={ev.invalidationConditions} />
                </Section>
              </div>

              <Section title="Supporting evidence" hint="each claim with its source">
                <EvidenceList items={ev.evidence} />
              </Section>

              {/* Equal weight to the thesis — dissent is not fine print. */}
              <Section title="Counterargument" hint="the case against this decision">
                {ev.counterargument ? <p>{ev.counterargument}</p> : <NotCaptured />}
              </Section>

              <Section title="Key risks">
                <Bullets items={ev.keyRisks} />
              </Section>

              <Section title="Portfolio impact" hint="effect on exposure and allocation">
                <Impact entries={ev.portfolioImpact} />
              </Section>

              <Section
                title="Probability impact"
                hint="effect on the odds of reaching the objective — distinct from confidence"
              >
                <Impact entries={ev.probabilityImpact} />
              </Section>

              {/* Provenance. Required by the contract; NULL on every row written
                  before ADR-APP-008, and shown as not captured rather than
                  backfilled with a guess about which model or prompt ran. */}
              <Section title="Provenance" hint="which policy, model and prompt produced this">
                <dl className="space-y-0.5">
                  {(
                    [
                      ["Objective", ev.provenance.objectiveId],
                      ["IPS version", ev.provenance.ipsVersion],
                      ["Model version", ev.provenance.modelVersion],
                      ["Prompt version", ev.provenance.promptVersion],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="flex flex-wrap gap-x-2">
                      <dt className="text-muted-foreground">{label}:</dt>
                      <dd>{value ?? <NotCaptured />}</dd>
                    </div>
                  ))}
                </dl>
              </Section>
            </div>
          ) : null}
        </>
      ) : (
        <div className="border-t px-4 py-2 text-xs text-muted-foreground">
          {/* Deliberately neutral: empty contract fields do not establish *why*
              they are empty. A row written after the migration by an extractor
              that skipped these columns looks identical to one that predates
              it, and asserting the reason would be a claim the data does not
              support — on a governed decision, of all places. */}
          No evidence recorded for this decision.
        </div>
      )}
    </div>
  );
}

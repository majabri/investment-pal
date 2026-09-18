// The universe, ranked by what the owner entered (UNIV-001 read side).
// Every sentence and the ordering are `lib/universeView.ts`'s; this lays out.
import { formatDistanceToNow } from "date-fns";

import { TIER_LABEL, rankUniverse, rankingSentence, type UniverseRowLike } from "@/lib/universeView";

export function UniverseRankPanel({ rows }: { rows: readonly UniverseRowLike[] }) {
  const ranking = rankUniverse(rows);
  return (
    <section aria-label="Universe by conviction" className="mb-4 rounded-xl border bg-card px-4 py-3 text-xs">
      <div className="mb-1 text-sm font-medium">Universe by conviction</div>
      <p className="text-muted-foreground">{rankingSentence(ranking)}</p>
      {ranking.names.length > 0 ? (
        <ol className="mt-2 grid gap-0.5 sm:grid-cols-2">
          {ranking.names.map((n) => (
            <li key={n.symbol} className="flex items-baseline gap-2">
              <span className="w-6 text-right tabular text-muted-foreground">{n.rank}</span>
              <span className="font-mono">{n.symbol}</span>
              {n.companyName ? <span className="truncate text-muted-foreground">{n.companyName}</span> : null}
              <span className="ml-auto text-muted-foreground">{TIER_LABEL[n.tier]}</span>
              <span className="w-16 text-right tabular">
                {n.conviction === null ? "unscored" : `${n.conviction}/10`}
              </span>
              <span className="w-24 text-right text-muted-foreground">
                {n.lastScoredAt ? formatDistanceToNow(new Date(n.lastScoredAt), { addSuffix: true }) : "never scored"}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

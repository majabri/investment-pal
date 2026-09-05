import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getNewsFn, type NewsCategory } from "@/lib/newsServer";
import { coverageNotice, coverageOf } from "@/lib/coverage";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/news")({ component: NewsPage });

const CATS: ("All" | NewsCategory)[] = [
  "All",
  "Markets",
  "Economy",
  "Technology",
  "Business",
  "World",
  "Crypto",
];

function ago(iso: string | null) {
  if (!iso) return "";
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

function NewsPage() {
  const [cat, setCat] = useState<(typeof CATS)[number]>("All");
  // The whole query, not just its data (rule 30). A failed fetch settles
  // `isLoading` to false and rendered an empty grid with no message, which
  // reads as "no news" — a claim, and one the committee prompt repeated.
  const query = useQuery({
    queryKey: ["news"],
    queryFn: () => getNewsFn(),
    refetchInterval: 10 * 60 * 1000,
  });
  const { data } = query;
  const coverage = coverageOf(query);
  const items = (data ?? []).filter((i) => cat === "All" || i.category === cat);

  return (
    <AppShell
      title="News"
      subtitle="Live headlines, sized by importance — recency, magnitude, portfolio relevance"
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {CATS.map((c) => (
          <Button
            key={c}
            size="sm"
            variant={cat === c ? "default" : "outline"}
            onClick={() => setCat(c)}
          >
            {c}
          </Button>
        ))}
      </div>
      {(() => {
        const notice = coverageNotice(
          "news",
          coverage,
          items.length,
          "No stories matched this filter.",
        );
        return notice === null ? null : (
          <p
            className={
              coverage === "UNAVAILABLE"
                ? "mb-3 text-sm font-medium text-amber-600 dark:text-amber-400"
                : "mb-3 text-sm text-muted-foreground"
            }
          >
            {notice}
          </p>
        );
      })()}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.slice(0, 24).map((n) => (
          <a
            key={n.link}
            href={n.link}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "rounded-lg border bg-card p-3 transition-colors hover:border-primary/50",
              n.score >= 60 && "md:col-span-2",
            )}
          >
            <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
              <Badge variant="outline" className="px-1.5 py-0">
                {n.category}
              </Badge>
              <span>{n.source}</span>
              <span className="ml-auto">{ago(n.publishedAt)}</span>
            </div>
            <div
              className={cn("font-medium leading-snug", n.score >= 60 ? "text-base" : "text-sm")}
            >
              {n.title}
            </div>
            {n.score >= 60 && n.description && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{n.description}</p>
            )}
          </a>
        ))}
      </div>
    </AppShell>
  );
}

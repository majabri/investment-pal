// Live market tape across the top of every screen. Pulls from the
// Yahoo-backed server function; refreshes every 5 minutes.
import { useQuery } from "@tanstack/react-query";
import { getMarketSnapshotFn } from "@/lib/marketServer";
import { cn } from "@/lib/utils";

const ORDER = [
  "S&P 500",
  "Nasdaq",
  "Dow",
  "VIX",
  "10Y Yield",
  "Oil (WTI)",
  "Gold",
  "Bitcoin",
  "US Dollar",
];

export function MarketTape() {
  const { data } = useQuery({
    queryKey: ["market-tape"],
    queryFn: () => getMarketSnapshotFn(),
    refetchInterval: 60 * 1000,
    staleTime: 45 * 1000,
  });

  return (
    <div className="flex h-9 items-center gap-5 overflow-x-auto whitespace-nowrap border-b bg-card/60 px-6 text-xs">
      {!data && <span className="text-muted-foreground">Loading market data…</span>}
      {data &&
        ORDER.map((name) => {
          const q = data.quotes[name];
          if (!q) return null;
          const isLevel = ["VIX", "10Y Yield"].includes(name);
          const value =
            name === "10Y Yield"
              ? `${q.price.toFixed(2)}%`
              : name === "Bitcoin"
                ? `$${(q.price / 1000).toFixed(1)}K`
                : q.price.toLocaleString("en-US", {
                    maximumFractionDigits:
                      name === "S&P 500" || name === "Nasdaq" || name === "Dow" ? 0 : 2,
                  });
          return (
            <span key={name} className="flex items-center gap-1.5">
              <span className="font-medium text-muted-foreground">{name}</span>
              <span className="tabular-nums text-foreground">{value}</span>
              {!isLevel && (
                <span
                  className={cn(
                    "tabular-nums",
                    q.changePct >= 0 ? "text-emerald-500" : "text-red-500",
                  )}
                >
                  {q.changePct >= 0 ? "+" : ""}
                  {q.changePct.toFixed(2)}%
                </span>
              )}
            </span>
          );
        })}
      {data && (
        <span className="ml-auto hidden text-muted-foreground/60 lg:inline">
          {new Date(data.asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
    </div>
  );
}

// Investment Office workflow launcher. The right workflow for the current
// market moment (US/Eastern) is highlighted; all are always available.
import { Link } from "@tanstack/react-router";
import { RefreshCw, Sunrise, Moon, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRefreshPrices } from "@/components/app/RefreshPricesButton";
import { useQueryClient } from "@tanstack/react-query";

function activeWorkflow(): "morning" | "refresh" | "evening" | "weekly" {
  const now = new Date();
  const et = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "numeric",
    hour12: false, weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => et.find((p) => p.type === t)?.value ?? "";
  const day = get("weekday");
  if (day === "Sat" || day === "Sun") return "weekly";
  const mins = parseInt(get("hour")) * 60 + parseInt(get("minute"));
  if (mins < 9 * 60 + 30) return "morning";
  if (mins < 16 * 60) return "refresh";
  return "evening";
}

export function WorkflowButtons({ symbols }: { symbols: string[] }) {
  const active = activeWorkflow();
  const { refresh, busy } = useRefreshPrices(symbols);
  const qc = useQueryClient();
  const v = (k: string) => (active === k ? "default" : "outline");

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      <Button asChild size="lg" variant={v("morning")} className="h-12">
        <Link to="/prompt-center" search={{ tab: "morning" }}>
          <Sunrise className="mr-2 h-4 w-4" /> Morning Review
        </Link>
      </Button>
      <Button size="lg" variant={v("refresh")} className="h-12" disabled={busy}
        onClick={() => { void refresh(); void qc.invalidateQueries({ queryKey: ["market-tape"] }); }}>
        <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Refreshing…" : "Mid-Day Meeting"}
      </Button>
      <Button asChild size="lg" variant={v("evening")} className="h-12">
        <Link to="/prompt-center" search={{ tab: "evening" }}>
          <Moon className="mr-2 h-4 w-4" /> End-of-Day Review
        </Link>
      </Button>
      <Button asChild size="lg" variant={v("weekly")} className="h-12">
        <Link to="/prompt-center" search={{ tab: "weekly" }}>
          <CalendarRange className="mr-2 h-4 w-4" /> Weekly Committee
        </Link>
      </Button>
      <Button asChild size="lg" variant="outline" className="h-12">
        <Link to="/prompt-center" search={{ tab: "monthly" }}>
          <CalendarRange className="mr-2 h-4 w-4" /> Monthly Board
        </Link>
      </Button>
    </div>
  );
}

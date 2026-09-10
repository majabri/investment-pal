// The live wiring for the source-health surface (OBS-001).
//
// Separated from `SourceHealthPanel` so the panel stays a pure function of its
// entries and can be tested without a network, a query client or a clock. This
// half is the part that actually probes.
//
// It issues the SAME queries the app's screens do, with the same query keys, so
// React Query serves them from cache when a screen has already asked. Opening
// this card does not hammer seven free endpoints; it reports what the app knows.
import { useQuery } from "@tanstack/react-query";
import { getMarketSnapshotFn } from "@/lib/marketServer";
import { getNewsFn, getGeopoliticsFn } from "@/lib/newsServer";
import { getEconCalendarFn } from "@/lib/calendarServer";
import { coverageOf } from "@/lib/coverage";
import { SOURCES } from "@/lib/sourceHealth";
import type { SourceHealth, SourceId } from "@/lib/sourceHealth";
import { SourceHealthPanel } from "./SourceHealthPanel";

const descriptorOf = (id: SourceId) => SOURCES.find((s) => s.id === id)!;

export function SourceHealthCard() {
  // Only the sources that can be probed WITHOUT arguments are queried here.
  // Quotes, daily closes and the earnings calendar all take a symbol list, and
  // a health card that invented one would be reporting on a request no screen
  // makes. They are reported as unprobed rather than guessed at.
  const snapshot = useQuery({
    queryKey: ["market-snapshot"],
    queryFn: () => getMarketSnapshotFn(),
    staleTime: 5 * 60 * 1000,
  });
  const news = useQuery({
    queryKey: ["news"],
    queryFn: () => getNewsFn(),
    staleTime: 10 * 60 * 1000,
  });
  const geo = useQuery({
    queryKey: ["geopolitics"],
    queryFn: () => getGeopoliticsFn(),
    staleTime: 10 * 60 * 1000,
  });
  const econ = useQuery({
    queryKey: ["econ-cal-health"],
    queryFn: () => getEconCalendarFn({ data: { days: 7 } }),
    staleTime: 60 * 60 * 1000,
  });

  const entries: SourceHealth[] = [
    { descriptor: descriptorOf("market-snapshot"), coverage: coverageOf(snapshot), lastOkAt: null },
    { descriptor: descriptorOf("econ-calendar"), coverage: coverageOf(econ), lastOkAt: null },
    { descriptor: descriptorOf("news"), coverage: coverageOf(news), lastOkAt: null },
    { descriptor: descriptorOf("geopolitics"), coverage: coverageOf(geo), lastOkAt: null },
  ];

  // The three that take a symbol list are named rather than omitted: a card
  // showing four of seven as though four were all is the same defect the panel
  // exists to fix, one level up.
  const unprobed = [
    {
      descriptor: descriptorOf("quotes"),
      reason: "checked per screen against the symbols that screen holds",
    },
    {
      descriptor: descriptorOf("prices"),
      reason: "checked by the backfill and the price recorder, not on demand",
    },
    {
      descriptor: descriptorOf("earnings-calendar"),
      reason: "needs a symbol list; checked on the screens that hold one",
    },
  ];

  return <SourceHealthPanel entries={entries} unprobed={unprobed} />;
}

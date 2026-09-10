// What is answering right now (OBS-001).
//
// The app reads seven free endpoints (OD-002) and they fail independently and
// routinely. Until now that was visible only per-screen, as an absence: a page
// that could not reach the earnings source looked much like a week with no
// earnings, and `coverage.ts` fixed the wording without ever gathering the
// sources into one place a person could look at.
//
// This is that place. It says which source, which provider, and what breaks —
// so a failure points somewhere rather than just being a shrug.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { healthSummary, overallHealth } from "@/lib/sourceHealth";
import type { OverallHealth, SourceDescriptor, SourceHealth } from "@/lib/sourceHealth";
import type { Coverage } from "@/lib/coverage";

/** Banner tone. `degraded` is amber, not red: one dead headline feed is not an
 *  outage, and colouring it like one trains the eye to skip the banner. */
const TONE: Record<OverallHealth, string> = {
  loading: "border-muted bg-muted/30 text-muted-foreground",
  ok: "border-emerald-500/40 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400",
  degraded: "border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-400",
  down: "border-destructive/40 bg-destructive/5 text-destructive",
};

/** Per-source wording. Never "none" — an unavailable source is UNKNOWN. */
function stateLabel(coverage: Coverage): string {
  if (coverage === "AVAILABLE") return "answered";
  if (coverage === "LOADING") return "checking…";
  return "did not answer";
}

function stateClass(coverage: Coverage): string {
  if (coverage === "AVAILABLE") return "text-emerald-600 dark:text-emerald-400";
  if (coverage === "LOADING") return "text-muted-foreground";
  return "text-amber-600 dark:text-amber-400";
}

export function SourceHealthPanel({
  entries,
  unprobed = [],
}: {
  entries: readonly SourceHealth[];
  /**
   * Sources this surface cannot check, named rather than omitted.
   *
   * Showing four of seven as though four were all is the same defect the panel
   * exists to fix, one level up: a complete-looking list that is quietly
   * partial. Each entry says why it could not be probed.
   */
  unprobed?: readonly { descriptor: SourceDescriptor; reason: string }[];
}) {
  const overall = overallHealth(entries);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Data sources</CardTitle>
      </CardHeader>
      <CardContent>
        <p role="status" className={`mb-3 rounded-lg border px-3 py-2 text-sm ${TONE[overall]}`}>
          {healthSummary(entries)}
        </p>
        {/* A list, not a <dl>. The rows carry four things — label, state,
            provider and (when failing) impact — so the term/definition pairing
            a definition list promises would be a lie about the structure, and
            axe says so: dt/dd nested below a wrapper are not a dl's children. */}
        <ul className="divide-y text-sm">
          {entries.map(({ descriptor, coverage }) => (
            <li key={descriptor.id} className="py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{descriptor.label}</span>
                <span className={`shrink-0 text-xs ${stateClass(coverage)}`}>
                  {stateLabel(coverage)}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">{descriptor.provider}</div>
              {/* Shown only when it is failing. The impact of a working source
                  is not information; the impact of a broken one is the whole
                  point of the panel. */}
              {coverage === "UNAVAILABLE" && (
                <div className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                  {descriptor.impact}
                </div>
              )}
            </li>
          ))}
        </ul>
        {unprobed.length > 0 && (
          <div className="mt-3 rounded-lg border border-muted bg-muted/20 px-3 py-2">
            <div className="text-[11px] font-medium">Not checked here</div>
            <ul className="mt-1 space-y-0.5">
              {unprobed.map(({ descriptor, reason }) => (
                <li key={descriptor.id} className="text-[11px] text-muted-foreground">
                  <span className="font-medium">{descriptor.label}</span> — {reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          Free sources only (OD-002). A source that does not answer makes its data{" "}
          <strong>unknown</strong> — never empty. This is live state for this page load; no history
          is recorded yet.
        </p>
      </CardContent>
    </Card>
  );
}

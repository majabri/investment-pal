// Today's priorities (audit brief G4).
//
// The one thing worth stating: an empty list here is a REAL answer — nothing is
// flagged — and it says so, rather than rendering an empty box. This panel is
// the exception to the "empty renders nothing" rule the advisory strips follow,
// because a priorities panel that vanishes when there are no priorities is
// indistinguishable from one that failed to load.
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";

export type Priority = { id: string; label: string; severity: string };

/** Severity → outline colour. Unknown severities take the neutral one rather
 *  than disappearing, so a new severity added server-side still renders. */
function severityClass(severity: string): string {
  if (severity === "critical") return "border-destructive/40 text-destructive";
  if (severity === "warning") return "border-warning/40 text-warning";
  return "border-primary/30 text-primary";
}

export function PrioritiesPanel({
  priorities,
  onDismiss,
}: {
  priorities: readonly Priority[];
  onDismiss: (id: string) => void;
}) {
  return (
    <section aria-label="Today's priorities" className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
          Today's priorities
        </h2>
        <Link to="/settings" className="text-xs text-muted-foreground hover:text-foreground">
          Manage
        </Link>
      </div>
      <ul className="mt-3 space-y-2">
        {priorities.length === 0 && (
          // Said, not omitted. A panel that vanishes when empty cannot be told
          // apart from one that failed to load.
          <li className="text-sm text-muted-foreground">
            Nothing flagged. Add priorities on the Settings page.
          </li>
        )}
        {priorities.map((p) => (
          <li
            key={p.id}
            className="flex items-start justify-between gap-2 rounded-lg border bg-background/40 px-3 py-2"
          >
            <div className="flex items-start gap-2">
              <Badge variant="outline" className={severityClass(p.severity)}>
                {p.severity}
              </Badge>
              <span className="text-sm">{p.label}</span>
            </div>
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onDismiss(p.id)}
              aria-label={`Dismiss: ${p.label}`}
            >
              Done
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

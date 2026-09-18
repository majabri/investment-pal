// The event record on screen (§19.1, §24, SYS-004).
//
// #233 wrote `domain_events` and `audit_log`; this is the first thing that
// reads them. One line per event — what changed, in the holder's words, from
// the audit row that raised it — newest first. The panel decides layout;
// every sentence is `activityView.ts`'s.
//
// An empty list here is NOT "nothing happened": the tables date from
// 2026-09-17 and the record starts with the first write after that. The
// empty state says so.
import { formatDistanceToNow } from "date-fns";

import { useActivity } from "@/hooks/useAppData";
import { useEventCursors } from "@/hooks/useEventConsumer";
import { cursorSentence, GOAL_CACHE_CONSUMER } from "@/lib/eventConsumers";
import {
  EMPTY_ACTIVITY,
  activitySentence,
  describeType,
  sortActivity,
  unreadableActivityNote,
} from "@/lib/activityView";

export function ActivityPanel() {
  const { data, isLoading, isError } = useActivity();
  const cursors = useEventCursors();

  return (
    <section className="mt-4 rounded-2xl border bg-card p-5" aria-label="Recent activity">
      <div className="mb-1 text-sm font-medium">Recent activity</div>
      <p className="mb-1 text-xs text-muted-foreground">
        Every material write, from the audit log. What changed and when, not what it means.
      </p>
      <p className="mb-3 text-xs text-muted-foreground" data-testid="consumer-cursor">
        {cursors.isError
          ? "Consumer cursors could not be read."
          : cursors.data === undefined
            ? "Reading consumer cursors…"
            : cursorSentence(cursors.data.find((c) => c.name === GOAL_CACHE_CONSUMER) ?? null)}
      </p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : isError || data === undefined ? (
        // A failed read says nothing about the record. Not "no activity".
        <p className="text-sm text-muted-foreground">
          The event record could not be read. Whether anything changed is not known from here.
        </p>
      ) : data.events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{EMPTY_ACTIVITY}</p>
      ) : (
        <>
          {unreadableActivityNote(data) && (
            <p className="mb-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {unreadableActivityNote(data)}
            </p>
          )}
          <ul className="space-y-1 text-sm">
            {sortActivity(data.events).map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 border-b py-1 last:border-0">
                <span className="w-28 flex-none text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(e.occurred_at), { addSuffix: true })}
                </span>
                <span className="flex-none rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {describeType(e.event_type)}
                </span>
                <span className="min-w-0 flex-1">{activitySentence(e)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// The app side of the per-consumer cursor (ADR-APP-018, option 2; migration
// 20260918210000, applied by Lovable 2026-09-18). Pure: what a consumer does
// with the outbox rows it read, decided here and tested; the hook only
// carries the effect.
//
// The first consumer is the cheapest honest one: GoalChanged → the goal-
// derived React Query caches in this tab are invalidated, and the cursor is
// advanced. It proves the mechanism before outcome measurement moves onto it.
//
// Rules held here:
//   * A row that cannot be read (no integer id, no event type) is COUNTED as
//     unreadable, never dropped, never guessed at.
//   * An event at or before the cursor is behind: counted, never re-handled
//     and never allowed to move the cursor.
//   * The cursor advances to the highest id handled, and only when something
//     was handled. The database refuses anything else (never backwards, never
//     past the last event); this side never asks for it.

/** The consumer's name, as `event_consumers.name` spells it (lower snake_case). */
export const GOAL_CACHE_CONSUMER = "goal_cache_invalidation";

/** The event this consumer acts on; every other event it merely passes. */
export const GOAL_EVENT = "GoalChanged";

/** The caches a GoalChanged event makes stale. `useAppData.ts` owns these keys. */
export const GOAL_QUERY_KEYS: readonly (readonly string[])[] = [["goal"], ["goal_versions"]];

/** Rows fetched per pass. A tab that is far behind catches up over several passes. */
export const OUTBOX_PAGE = 200;

export type OutboxRowLike = { id: unknown; event_type: unknown };
export type OutboxEvent = { id: number; event_type: string };

/** Validate at the boundary. PostgREST sends bigint as a JSON number; a string is tolerated. */
export function readOutboxRows(rows: readonly OutboxRowLike[]): { events: OutboxEvent[]; unreadable: number } {
  const events: OutboxEvent[] = [];
  let unreadable = 0;
  for (const r of rows) {
    const id = typeof r.id === "number" ? r.id : typeof r.id === "string" && /^\d+$/.test(r.id) ? Number(r.id) : NaN;
    if (!Number.isInteger(id) || id < 0 || typeof r.event_type !== "string" || r.event_type === "") {
      unreadable++;
      continue;
    }
    events.push({ id, event_type: r.event_type });
  }
  return { events, unreadable };
}

export type ConsumePlan = {
  /** The cursor to advance to; equals `cursor` when nothing is to be handled. */
  next: number;
  /** Events past the cursor, in this page. */
  handled: number;
  /** Events at or before the cursor: already passed, counted, not re-handled. */
  behind: number;
  /** GoalChanged events among those handled. */
  goalChanged: number;
  /** The query keys to invalidate. Empty unless a GoalChanged was handled. */
  invalidate: readonly (readonly string[])[];
};

export function consumePlan(events: readonly OutboxEvent[], cursor: number): ConsumePlan {
  let next = cursor;
  let handled = 0;
  let behind = 0;
  let goalChanged = 0;
  for (const e of events) {
    if (e.id <= cursor) {
      behind++;
      continue;
    }
    handled++;
    if (e.id > next) next = e.id;
    if (e.event_type === GOAL_EVENT) goalChanged++;
  }
  return { next, handled, behind, goalChanged, invalidate: goalChanged > 0 ? GOAL_QUERY_KEYS : [] };
}

export type CursorRowLike = { name: string; last_event_id: number | string; updated_at: string };

/** What the settings screen says about a consumer. Unknown says unknown. */
export function cursorSentence(row: CursorRowLike | null | undefined, now: Date = new Date()): string {
  if (!row) return `${GOAL_CACHE_CONSUMER}: not registered in this browser yet.`;
  const id = Number(row.last_event_id);
  const at = new Date(row.updated_at);
  const ago = Number.isFinite(at.getTime()) ? Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000)) : null;
  const when = ago === null ? "at an unknown time" : ago === 0 ? "within the last minute" : ago === 1 ? "1 minute ago" : `${ago} minutes ago`;
  const where = Number.isInteger(id) && id > 0 ? `past event #${id}` : "before any event";
  return `${row.name}: ${where}, advanced ${when}.`;
}

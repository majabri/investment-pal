// The generated row shapes, named once (CONST-002).
//
// Payload builders used to return `Record<string, unknown>` and every call site
// then cast the result with `as never` to get it past the client. That pair —
// a shapeless return and a cast to swallow it — is a typed write in name only:
// a misspelt column, a missing NOT NULL field, or a value of the wrong type
// compiled cleanly and failed at runtime, on tables holding money.
//
// `security_aliases.source` is the worked example. It is NOT NULL with no
// default, the first builder written for it omitted the field, and nothing
// caught it until the generated types were allowed to do their job.
//
// These aliases exist so a builder can say what it builds without each module
// spelling out the same `Database["public"]["Tables"][...]` path.
import type { Database } from "@/integrations/supabase/types";

type Tables = Database["public"]["Tables"];

/** The insert shape for one table. */
export type Insert<T extends keyof Tables> = Tables[T]["Insert"];

/** The update shape for one table. */
export type Update<T extends keyof Tables> = Tables[T]["Update"];

/** The row shape for one table, as it comes back from a select. */
export type Row<T extends keyof Tables> = Tables[T]["Row"];

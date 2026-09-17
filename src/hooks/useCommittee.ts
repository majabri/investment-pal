// The committee's write path (DEC-001..004, §22.1) — its own module on purpose.
//
// `aiBoundary.test.ts` holds that a file which handles a model response may
// write only to the tables AI output is allowed to reach. `useAppData.ts`
// writes to accounts, holdings, cash flows and everything else; putting the
// committee's insert beside those would have made the one file that must
// never write a financial figure from model text the same file that writes
// every financial figure. So the committee writes from here, and here writes
// nothing but `decisions`.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabaseClient";
import { assertAiWritable } from "@/lib/aiBoundary";
import type { CommitteeOutput } from "@/lib/committeeContract";
import { decisionInserts, type DecisionStamp } from "@/lib/committeeDecisions";

/**
 * Record the committee's decisions from one run.
 *
 * Takes the committee's structured output — model text, validated on the
 * server — and the context to stamp it with, and builds the rows here so the
 * one place model output becomes a database row is also the one place the AI
 * boundary is checked. A throw, not a filter: a dropped field would leave the
 * caller believing it had been saved (rule 18).
 *
 * A BLOCKED readiness verdict yields no rows, and that is refused rather than
 * silently succeeding — "recorded zero decisions" must not read as "recorded".
 */
export function useRecordCommitteeDecisions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { output: CommitteeOutput; stamp: DecisionStamp }): Promise<number> => {
      const rows = decisionInserts(p.output.decisions, p.stamp);
      if (rows.length === 0) {
        throw new Error("Nothing to record: the readiness gate blocked this review.");
      }
      for (const row of rows) assertAiWritable("decisions", row);
      const { error } = await supabase.from("decisions").insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        predicate: (q: { queryKey: readonly unknown[] }) =>
          String(q.queryKey[0]).startsWith("decisions"),
      });
    },
  });
}

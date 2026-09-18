// The universe's one write path (ADR-APP-017): the owner's paste, upserted on
// (user_id, symbol), recorded as an import batch. Removing a row is the
// owner's own DELETE. The Committee never writes here.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabaseClient";
import { sha256Hex, utf8ByteLength } from "@/lib/importBatch";
import { universeCommittedPatch, universeStagedBatch, universeUpsertRows } from "@/lib/universeImport";
import type { UniverseParse } from "@/lib/universeImport";
import { failedPatch } from "@/lib/importBatch";

export function useImportUniverse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { parse: UniverseParse; rawText: string }): Promise<{ upserted: number }> => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Not signed in.");
      const userId = auth.user.id;
      // The batch opens BEFORE the write so an interrupted import leaves a true row.
      const staged = universeStagedBatch({
        userId,
        checksum: await sha256Hex(p.rawText),
        sizeBytes: utf8ByteLength(p.rawText),
        parsedRows: p.parse.rows.length + p.parse.skipped.length,
        validRows: p.parse.rows.length,
      });
      const { data: batch, error: batchErr } = await supabase.from("import_batches").insert(staged).select("id").single();
      if (batchErr) throw batchErr;
      try {
        const { error } = await supabase
          .from("investment_universe")
          .upsert(universeUpsertRows(p.parse.rows, userId), { onConflict: "user_id,symbol" });
        if (error) throw error;
        await supabase.from("import_batches").update(universeCommittedPatch(p.parse.rows.length, p.parse.skipped.length)).eq("id", batch.id);
        return { upserted: p.parse.rows.length };
      } catch (e) {
        await supabase.from("import_batches").update(failedPatch(e)).eq("id", batch.id);
        throw e;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["investment_universe"] }),
  });
}

export function useRemoveUniverseSymbol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (symbol: string) => {
      const { error } = await supabase.from("investment_universe").delete().eq("symbol", symbol);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["investment_universe"] }),
  });
}

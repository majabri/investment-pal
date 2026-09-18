// The universe, written by its owner (ADR-APP-017). Paste, preview, import;
// remove a row by hand. The Committee reads this and never writes it.
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useImportUniverse, useRemoveUniverseSymbol } from "@/hooks/useUniverseImport";
import { parseUniverseText, previewSentence } from "@/lib/universeImport";

export function UniverseImportPanel({ current }: { current: readonly { symbol: string; tier?: string | null }[] }) {
  const [text, setText] = useState("");
  const parse = useMemo(() => parseUniverseText(text), [text]);
  const importMutation = useImportUniverse();
  const remove = useRemoveUniverseSymbol();

  return (
    <section aria-label="Investment universe" className="mb-4 rounded-xl border bg-card px-4 py-3 text-xs">
      <div className="mb-1 text-sm font-medium">Investment universe — {current.length} {current.length === 1 ? "name" : "names"}</div>
      <p className="text-muted-foreground">
        Paste one symbol per line, or a table with a header (symbol, tier, and any of the 1–10 scores). Tiers: top100, top25, bench. Existing symbols are updated; nothing is removed by a paste.
      </p>
      <textarea
        className="mt-2 h-28 w-full rounded-md border bg-background p-2 font-mono text-xs"
        aria-label="Universe paste"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"symbol,tier\nSYMA,top25\nSYMB,top100"}
      />
      <p className="mt-1 text-muted-foreground">{previewSentence(parse)}</p>
      {parse.skipped.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          {parse.skipped.slice(0, 8).map((s) => (
            <li key={s.line}>Line {s.line}: {s.reason}</li>
          ))}
          {parse.skipped.length > 8 ? <li>… and {parse.skipped.length - 8} more</li> : null}
        </ul>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" disabled={parse.rows.length === 0 || importMutation.isPending} onClick={() => importMutation.mutate({ parse, rawText: text }, { onSuccess: () => setText("") })}>
          {importMutation.isPending ? "Importing…" : `Import ${parse.rows.length || ""}`.trim()}
        </Button>
        {importMutation.isError ? <span className="text-destructive">{(importMutation.error as Error).message}</span> : null}
        {importMutation.isSuccess ? <span className="text-muted-foreground">Imported {importMutation.data.upserted}.</span> : null}
      </div>
      {current.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-muted-foreground">Current names ({current.length})</summary>
          <ul className="mt-1 grid gap-0.5 sm:grid-cols-2">
            {current.map((u) => (
              <li key={u.symbol} className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-mono">{u.symbol}</span>
                  {u.tier ? <span className="text-muted-foreground"> · {u.tier}</span> : null}
                </span>
                <button type="button" className="underline underline-offset-2 text-muted-foreground" onClick={() => remove.mutate(u.symbol)} disabled={remove.isPending}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

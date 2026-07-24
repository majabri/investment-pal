import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parsePositionsCsv } from "@/lib/csvImport";

export const Route = createFileRoute("/_authenticated/import")({
  component: ImportPage,
});

function ImportPage() {
  const [raw, setRaw] = useState("");
  const [summary, setSummary] = useState<string | null>(null);

  function preview() {
    const res = parsePositionsCsv(raw);
    if (!res.holdings.length) {
      toast.error("No positions recognized — paste Fidelity's Positions CSV or page text.");
      return;
    }
    const total = res.holdings.reduce((s, h) => s + (h.currentValue ?? 0), 0);
    setSummary(`${res.holdings.length} positions parsed · $${total.toLocaleString("en-US", { maximumFractionDigits: 0 })} total value. Save-to-portfolio wiring completes in the next PR — use Settings → Import for now.`);
  }

  return (
    <AppShell title="Fidelity Import" subtitle="Read-only. Paste the Positions CSV export or the positions page text.">
      <Card>
        <CardHeader><CardTitle className="text-base">Paste positions</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={10}
            placeholder="Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,..." />
          <div className="flex items-center gap-3">
            <Button onClick={preview}>Parse & preview</Button>
            {summary && <span className="text-sm text-muted-foreground">{summary}</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            This app never connects to your Fidelity login and never places trades. Import is the only data path.
          </p>
        </CardContent>
      </Card>
    </AppShell>
  );
}

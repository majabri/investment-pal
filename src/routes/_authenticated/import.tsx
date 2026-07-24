import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parsePositionsCsv, type ParsedHolding } from "@/lib/csvImport";
import { supabase } from "@/integrations/supabase/client";
import { fmtUSD } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/import")({
  component: ImportPage,
});

/** Map a Fidelity account label to an app account name (kids by keyword). */
function accountNameFor(label: string | undefined): string {
  const l = (label ?? "").toLowerCase();
  for (const kid of ["karim", "zain", "jude"]) {
    if (l.includes(kid)) return kid[0].toUpperCase() + kid.slice(1);
  }
  return "Amir - TOD";
}

function ImportPage() {
  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState<ParsedHolding[] | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  function onFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setRaw(text);
      const res = parsePositionsCsv(text);
      if (!res.rows.length) {
        toast.error(`"${file.name}" parsed but no positions recognized — is it the Positions export?`);
        setParsed(null);
        return;
      }
      setParsed(res.rows);
      toast.success(`${file.name}: ${res.rows.length} positions ready to save.`);
    };
    reader.onerror = () => toast.error("Could not read the file.");
    reader.readAsText(file);
  }

  function preview() {
    const res = parsePositionsCsv(raw);
    if (!res.rows.length) {
      toast.error("No positions recognized — paste Fidelity's Positions CSV export.");
      return;
    }
    setParsed(res.rows);
  }

  async function save() {
    if (!parsed?.length) return;
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("Not signed in");

      // Group parsed rows by target account name
      const groups = new Map<string, ParsedHolding[]>();
      for (const h of parsed) {
        const name = accountNameFor(h.accountName);
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name)!.push(h);
      }

      const { data: existing } = await supabase.from("accounts").select("id,name").eq("user_id", userId);
      let saved = 0;
      for (const [name, holdings] of groups) {
        let acct = existing?.find((a) => a.name === name);
        if (!acct) {
          const { data: created, error } = await supabase.from("accounts")
            .insert({ user_id: userId, name }).select("id,name").single();
          if (error) throw error;
          acct = created;
        }
        const rows = holdings
          .filter((h) => h.symbol && h.quantity != null)
          .map((h) => ({
            user_id: userId,
            account_id: acct!.id,
            symbol: h.symbol.toUpperCase(),
            quantity: h.quantity ?? 0,
            cost_basis: h.cost_basis ?? 0,
            current_price: h.current_price || (h.quantity ? (h.currentValue ?? 0) / h.quantity : 0),
            last_price_at: new Date().toISOString(),
          }));
        const { error: upErr } = await supabase.from("holdings")
          .upsert(rows, { onConflict: "user_id,account_id,symbol" });
        if (upErr) throw upErr;
        await supabase.from("accounts")
          .update({ last_synced_at: new Date().toISOString() })
          .eq("id", acct!.id);
        saved += rows.length;
      }
      toast.success(`Saved ${saved} positions across ${groups.size} account(s).`);
      setParsed(null);
      setRaw("");
      void qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const total = parsed?.reduce((s, h) => s + (h.currentValue ?? h.quantity * h.current_price), 0) ?? 0;

  return (
    <AppShell title="Fidelity Import" subtitle="Read-only. Upload the Positions CSV export (Fidelity → Positions → Download) or paste its text — kids' accounts are detected by name.">
      <Card>
        <CardHeader><CardTitle className="text-base">Paste positions</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={10}
            placeholder="Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,..." />
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden"
              onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
            <Button onClick={() => fileRef.current?.click()}>Upload CSV file</Button>
            <Button onClick={preview} variant="secondary">Parse pasted text</Button>
            {parsed && (
              <Button onClick={() => void save()} disabled={busy}>
                {busy ? "Saving…" : `Save ${parsed.length} positions (${fmtUSD(total)})`}
              </Button>
            )}
          </div>
          {parsed && (
            <div className="max-h-56 overflow-y-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead><tr className="border-b text-left text-muted-foreground">
                  <th className="p-2">Account</th><th>Symbol</th><th className="text-right">Qty</th><th className="text-right p-2">Value</th></tr></thead>
                <tbody>
                  {parsed.map((h, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="p-2">{accountNameFor(h.accountName)}</td>
                      <td className="font-medium">{h.symbol}</td>
                      <td className="text-right tabular-nums">{h.quantity}</td>
                      <td className="p-2 text-right tabular-nums">{fmtUSD(h.currentValue ?? h.quantity * h.current_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            This app never connects to your Fidelity login and never places trades. Import is the only data path.
          </p>
        </CardContent>
      </Card>
    </AppShell>
  );
}

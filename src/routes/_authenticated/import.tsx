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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/import")({
  component: ImportPage,
});

const DESTINATIONS = [
  { value: "Amir - TOD", label: "Amir Portfolio (Amir - TOD)" },
  { value: "Karim", label: "Kids — Karim" },
  { value: "Zain", label: "Kids — Zain" },
  { value: "Jude", label: "Kids — Jude" },
  { value: "__skip__", label: "Skip this account" },
] as const;

/** Smart default destination from the Fidelity label (user can override). */
function defaultDestination(label: string | undefined): string {
  const l = (label ?? "").toLowerCase();
  for (const kid of ["karim", "zain", "jude"]) {
    if (l.includes(kid)) return kid[0].toUpperCase() + kid.slice(1);
  }
  return "Amir - TOD";
}

function ImportPage() {
  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState<ParsedHolding[] | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
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
      initMapping(res.rows);
      toast.success(`${file.name}: ${res.rows.length} positions ready — choose destinations below.`);
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
    initMapping(res.rows);
  }

  function initMapping(rows: ParsedHolding[]) {
    const m: Record<string, string> = {};
    for (const h of rows) {
      const key = h.accountName ?? "Unlabeled account";
      if (!(key in m)) m[key] = defaultDestination(h.accountName);
    }
    setMapping(m);
  }

  async function save() {
    if (!parsed?.length) return;
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("Not signed in");

      // Group parsed rows by the user's chosen destination
      const groups = new Map<string, ParsedHolding[]>();
      for (const h of parsed) {
        const key = h.accountName ?? "Unlabeled account";
        const dest = mapping[key] ?? defaultDestination(h.accountName);
        if (dest === "__skip__") continue;
        if (!groups.has(dest)) groups.set(dest, []);
        groups.get(dest)!.push(h);
      }
      if (groups.size === 0) { toast.error("Every account is set to Skip — nothing to save."); setBusy(false); return; }

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
    <AppShell title="Fidelity Import" subtitle="Read-only. Upload the Positions CSV or paste its text, then choose where each Fidelity account imports to.">
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
            <div className="space-y-4">
              {Object.entries(
                parsed.reduce<Record<string, ParsedHolding[]>>((acc, h) => {
                  const k = h.accountName ?? "Unlabeled account";
                  (acc[k] ??= []).push(h);
                  return acc;
                }, {}),
              ).map(([label, rows]) => {
                const subtotal = rows.reduce((x, h) => x + (h.currentValue ?? h.quantity * h.current_price), 0);
                return (
                  <div key={label} className="rounded-lg border">
                    <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 p-3">
                      <div className="min-w-40 flex-1">
                        <div className="text-sm font-medium">{label}</div>
                        <div className="text-xs text-muted-foreground">{rows.length} positions · {fmtUSD(subtotal)}</div>
                      </div>
                      <div className="w-64">
                        <Select value={mapping[label]} onValueChange={(v) => setMapping((m) => ({ ...m, [label]: v }))}>
                          <SelectTrigger><SelectValue placeholder="Import to…" /></SelectTrigger>
                          <SelectContent>
                            {DESTINATIONS.map((d) => (
                              <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {mapping[label] !== "__skip__" && (
                      <table className="w-full text-xs">
                        <tbody>
                          {rows.slice(0, 6).map((h, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="p-2 font-medium">{h.symbol}</td>
                              <td className="text-right tabular-nums">{h.quantity}</td>
                              <td className="p-2 text-right tabular-nums">{fmtUSD(h.currentValue ?? h.quantity * h.current_price)}</td>
                            </tr>
                          ))}
                          {rows.length > 6 && (
                            <tr><td colSpan={3} className="p-2 text-muted-foreground">+ {rows.length - 6} more…</td></tr>
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
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

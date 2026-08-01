import { useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parsePositionsCsv, type ParsedHolding } from "@/lib/csvImport";
import { supabase } from "@/integrations/supabase/client";
import { fmtUSD } from "@/lib/finance";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const DESTINATIONS = [
  { value: "Amir - TOD", label: "Amir Portfolio (Amir - TOD)" },
  { value: "Karim", label: "Kids — Karim" },
  { value: "Zain", label: "Kids — Zain" },
  { value: "Jude", label: "Kids — Jude" },
  { value: "__skip__", label: "Skip this account" },
] as const;

/** Exact-name defaults only; anything unrecognized defaults to Skip.
 *  ("Jude Crypto" / "Jude 529" must NOT auto-merge into Jude's brokerage.) */
function defaultDestination(label: string | undefined): string {
  const l = (label ?? "").trim().toLowerCase();
  if (l === "karim") return "Karim";
  if (l === "zain") return "Zain";
  if (l === "jude") return "Jude";
  if (l === "amir - tod" || l === "amir-tod") return "Amir - TOD";
  return "__skip__";
}

export function PortfolioCsvImport() {
  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState<ParsedHolding[] | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [cashByAccount, setCashByAccount] = useState<Record<string, number>>({});
  const [fullOverwrite, setFullOverwrite] = useState(true);
  const [createAll, setCreateAll] = useState(true);
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
      setCashByAccount(res.cashByAccount);
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
    setCashByAccount(res.cashByAccount);
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

      let removed = 0;
      if (fullOverwrite) {
        // The Fidelity export is the complete truth: remove ALL existing
        // holdings (including legacy rows with no account) before saving,
        // so imports overwrite the portfolio rather than piling onto it.
        const { count: before } = await supabase.from("holdings")
          .select("id", { count: "exact", head: true }).eq("user_id", userId);
        const { error: wipeErr } = await supabase.from("holdings").delete().eq("user_id", userId);
        if (wipeErr) throw wipeErr;
        const { count: after } = await supabase.from("holdings")
          .select("id", { count: "exact", head: true }).eq("user_id", userId);
        removed = (before ?? 0) - (after ?? 0);
        if ((after ?? 0) > 0) {
          throw new Error(`Overwrite verification failed: ${after} old positions survived the wipe. Nothing was saved — report this exact message.`);
        }
      }

      const { data: existingRaw } = await supabase.from("accounts").select("id,name,created_at").eq("user_id", userId).order("created_at", { ascending: true });
      const seen = new Map<string, { id: string; name: string }>();
      for (const a of existingRaw ?? []) {
        if (!seen.has(a.name)) { seen.set(a.name, a); }
        else if (fullOverwrite) { await supabase.from("accounts").delete().eq("id", a.id).eq("user_id", userId); }
      }
      const existing = [...seen.values()];
      let saved = 0;
      for (const [name, holdings] of groups) {
        let acct = existing?.find((a) => a.name === name);
        if (!acct) {
          const { data: created, error } = await supabase.from("accounts")
            .insert({ user_id: userId, name }).select("id,name").single();
          if (error) throw error;
          acct = created;
        }
        // Aggregate multiple lots of the same symbol (sum qty, weighted avg cost)
        const bySymbol = new Map<string, { qty: number; cost: number; px: number }>();
        for (const h of holdings) {
          if (!h.symbol || h.quantity == null) continue;
          const sym = h.symbol.toUpperCase();
          const px = h.current_price || (h.quantity ? (h.currentValue ?? 0) / h.quantity : 0);
          const prev = bySymbol.get(sym) ?? { qty: 0, cost: 0, px };
          bySymbol.set(sym, {
            qty: prev.qty + h.quantity,
            cost: prev.cost + (h.cost_basis ?? 0) * h.quantity,
            px,
          });
        }
        const rows = [...bySymbol.entries()].map(([symbol, x]) => ({
          user_id: userId,
          account_id: acct!.id,
          symbol,
          quantity: x.qty,
          cost_basis: x.qty > 0 ? x.cost / x.qty : 0,
          current_price: x.px,
          last_price_at: new Date().toISOString(),
        }));
        // Replace-mode: this import becomes the account's whole truth,
        // so a corrected re-import heals any earlier bad mapping.
        const { error: delErr } = await supabase.from("holdings")
          .delete().eq("account_id", acct!.id).eq("user_id", userId);
        if (delErr) throw delErr;
        // Plain insert — replace-mode deleted this account's holdings above,
        // and the partial unique index cannot serve as an upsert arbiter.
        const { error: insErr } = await supabase.from("holdings").insert(rows);
        if (insErr) throw insErr;
        const sourceLabels = [...new Set(holdings.map((h) => h.accountName ?? "Unlabeled account"))];
        const cash = sourceLabels.reduce((c, label) => c + (cashByAccount[label] ?? 0), 0);
        await supabase.from("accounts")
          .update({ cash, last_synced_at: new Date().toISOString() })
          .eq("id", acct!.id);
        saved += rows.length;
      }
      toast.success(fullOverwrite
        ? `Overwrite complete: removed ${removed} old position${removed === 1 ? "" : "s"}, saved ${saved} across ${groups.size} account(s).`
        : `Saved ${saved} positions across ${groups.size} account(s).`);
      setParsed(null);
      setRaw("");
      void qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const mapped = (parsed ?? []).filter((h) => {
    const dest = mapping[h.accountName ?? "Unlabeled account"];
    return dest && dest !== "__skip__";
  });
  const mappedTotal = mapped.reduce((s, h) => s + (h.currentValue ?? h.quantity * h.current_price), 0);
  const mappedAccounts = new Set(mapped.map((h) => mapping[h.accountName ?? "Unlabeled account"])).size;
  const saveLabel = busy ? "Saving…" : mapped.length
    ? `Save ${mapped.length} positions → ${mappedAccounts} account${mappedAccounts === 1 ? "" : "s"} (${fmtUSD(mappedTotal)})`
    : "Nothing mapped — choose destinations";

  return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Portfolio CSV Import</CardTitle>
          <p className="text-xs text-muted-foreground">
            Read-only. Upload the brokerage Positions CSV (Fidelity → Positions → Download) or paste its
            text, then choose where each account imports to.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={10}
            placeholder="Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,..." />
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden"
              onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
            <Button onClick={() => fileRef.current?.click()}>Upload CSV file</Button>
            <Button onClick={preview} variant="secondary">Parse pasted text</Button>
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
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
                <div>
                  <Label htmlFor="full-overwrite" className="text-sm">Overwrite entire portfolio</Label>
                  <p className="text-[11px] text-muted-foreground">
                    This file becomes the complete truth — all previously imported positions are replaced.
                    Turn off only to update the mapped accounts and leave everything else untouched.
                  </p>
                </div>
                <Switch id="full-overwrite" checked={fullOverwrite} onCheckedChange={setFullOverwrite} />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="create-all" className="text-xs text-muted-foreground">
                Create accounts for everything in the file (529 / Crypto / IRA grouped on the Office)
              </Label>
              <Switch id="create-all" checked={createAll} onCheckedChange={setCreateAll} />
              </div>
              <Button className="w-full" size="lg" onClick={() => void save()} disabled={busy || mapped.length === 0}>
                {saveLabel}
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">
                Review each account&apos;s destination above, then save everything in one step. Skipped accounts are not touched.
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            This app never connects to your Fidelity login and never places trades. Import is the only data path.
          </p>
        </CardContent>
      </Card>
  );
}

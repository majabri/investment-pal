import { useMemo, useRef, useState } from "react";
import { useAccountContext } from "@/contexts/AccountContext";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parsePositionsCsv, type ParsedHolding } from "@/lib/csvImport";
import { cashForAccount } from "@/lib/importSafety";
import { supabase } from "@/lib/supabaseClient";
import { fmtUSD } from "@/lib/finance";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const CREATE = "__create__";
const SKIP = "__skip__";

type Destination = { value: string; label: string };

/** Destinations are the user's own accounts, not a hardcoded list (PR-UI-2).
 *  Previously this named four specific accounts, so the importer only worked
 *  for one household and silently offered dead options to anyone else. */
function destinationsFor(accountNames: string[]): Destination[] {
  // De-duplicated: `accounts.name` carries no unique constraint, and the import
  // groups rows by destination *name*, so two accounts sharing a name would
  // otherwise emit duplicate option keys and values for what resolves to one
  // destination. (The underlying ambiguity — two accounts, one name — predates
  // this and is a data question, not one the picker can settle.)
  const unique = [...new Set(accountNames)];
  return [
    ...unique.map((name) => ({ value: name, label: name })),
    { value: CREATE, label: "Create this account (keep the name from the file)" },
    { value: SKIP, label: "Skip this account" },
  ];
}

/** A CSV account label maps to an existing account when the names match
 *  (case- and separator-insensitive, so "Foo-TOD" still matches "Foo - TOD").
 *  Anything else is created under its own Fidelity name when create-all is on,
 *  else skipped. */
function normalizeAccountName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function defaultDestination(
  label: string | undefined,
  createAll: boolean,
  accountNames: string[],
): string {
  const l = normalizeAccountName(label ?? "");
  const match = accountNames.find((n) => normalizeAccountName(n) === l);
  if (match) return match;
  return createAll ? CREATE : SKIP;
}

export function PortfolioCsvImport() {
  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState<ParsedHolding[] | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [cashByAccount, setCashByAccount] = useState<Record<string, number>>({});
  const [createAll, setCreateAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const { accounts } = useAccountContext();
  const accountNames = useMemo(() => accounts.map((a) => a.name), [accounts]);
  const destinations = useMemo(() => destinationsFor(accountNames), [accountNames]);

  function onFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setRaw(text);
      const res = parsePositionsCsv(text);
      if (!res.rows.length) {
        toast.error(
          `"${file.name}" parsed but no positions recognized — is it the Positions export?`,
        );
        setParsed(null);
        return;
      }
      setParsed(res.rows);
      setCashByAccount(res.cashByAccount);
      initMapping(res.rows);
      toast.success(
        `${file.name}: ${res.rows.length} positions ready — choose destinations below.`,
      );
    };
    reader.onerror = () => toast.error("Could not read the file.");
    reader.readAsText(file);
  }

  function preview() {
    const res = parsePositionsCsv(raw);
    if (!res.rows.length) {
      toast.error("No positions recognized — paste your broker's Positions CSV export.");
      return;
    }
    setParsed(res.rows);
    setCashByAccount(res.cashByAccount);
    initMapping(res.rows);
  }

  function initMapping(rows: ParsedHolding[], create = createAll) {
    const m: Record<string, string> = {};
    for (const h of rows) {
      const key = h.accountName ?? "Unlabeled account";
      if (!(key in m)) m[key] = defaultDestination(h.accountName, create, accountNames);
    }
    setMapping(m);
  }

  function onToggleCreateAll(next: boolean) {
    setCreateAll(next);
    // Re-default any unknown accounts the user hasn't manually remapped
    setMapping((m) => {
      const out: Record<string, string> = { ...m };
      for (const [label, dest] of Object.entries(m)) {
        if (dest === SKIP || dest === CREATE) {
          out[label] = defaultDestination(label, next, accountNames);
        }
      }
      return out;
    });
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
        const destRaw = mapping[key] ?? defaultDestination(h.accountName, createAll, accountNames);
        if (destRaw === SKIP) continue;
        const dest = destRaw === CREATE ? key : destRaw; // create keeps the name the file used
        if (!groups.has(dest)) groups.set(dest, []);
        groups.get(dest)!.push(h);
      }
      if (groups.size === 0) {
        toast.error("Every account is set to Skip — nothing to save.");
        setBusy(false);
        return;
      }

      // The user-wide wipe is gone (rule 29). It deleted EVERY holding the
      // user had — including accounts this import was not mapping and could
      // not restore — on the argument that a broker export is the complete
      // portfolio. It is not: a user may skip accounts, map only one, or hold
      // positions at another broker entirely. Each destination account is now
      // replaced by its own atomic call, and nothing else is touched.
      const { data: existingRaw } = await supabase
        .from("accounts")
        .select("id,name,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      const seen = new Map<string, { id: string; name: string }>();
      for (const a of existingRaw ?? []) {
        if (!seen.has(a.name)) seen.set(a.name, a);
      }
      const existing = [...seen.values()];

      const asOf = new Date().toISOString();
      let saved = 0;
      let removed = 0;
      for (const [name, holdings] of groups) {
        let acct = existing?.find((a) => a.name === name);
        if (!acct) {
          const { data: created, error } = await supabase
            .from("accounts")
            .insert({ user_id: userId, name })
            .select("id,name")
            .single();
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
          symbol,
          quantity: x.qty,
          cost_basis: x.qty > 0 ? x.cost / x.qty : 0,
          current_price: x.px,
        }));

        const sourceLabels = [
          ...new Set(holdings.map((h) => h.accountName ?? "Unlabeled account")),
        ];
        // NULL when the export carried no cash line for this account. The
        // code this replaces summed `?? 0`, writing a real $0.00 balance for
        // an account nobody had told the app about (Phase 1a, rule 13).
        const cash = cashForAccount(sourceLabels, cashByAccount);

        // One atomic call per account. DELETE-then-INSERT in the client left
        // an account with NO POSITIONS if the insert failed after the delete,
        // and dropped every thesis, note and review on every import (rule 29).
        const { data: result, error: rpcErr } = await supabase.rpc(
          "import_account_positions" as never,
          {
            p_account_id: acct!.id,
            p_rows: rows,
            p_cash: cash,
            p_as_of: asOf,
            p_source: "portfolio_csv",
          } as never,
        );
        if (rpcErr) throw rpcErr;
        const r = (result ?? {}) as { inserted?: number; updated?: number; removed?: number };
        saved += (r.inserted ?? 0) + (r.updated ?? 0);
        removed += r.removed ?? 0;
      }
      // Auditable (rule 29): says what happened, including the removals,
      // which are the part the user cannot see in the file they chose.
      toast.success(
        removed > 0
          ? `Saved ${saved} position${saved === 1 ? "" : "s"} across ${groups.size} account(s); removed ${removed} no longer in the file. Theses and notes were kept.`
          : `Saved ${saved} position${saved === 1 ? "" : "s"} across ${groups.size} account(s). Theses and notes were kept.`,
      );
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
    return dest && dest !== SKIP;
  });
  const mappedTotal = mapped.reduce(
    (s, h) => s + (h.currentValue ?? h.quantity * h.current_price),
    0,
  );
  const mappedAccounts = new Set(mapped.map((h) => mapping[h.accountName ?? "Unlabeled account"]))
    .size;
  const saveLabel = busy
    ? "Saving…"
    : mapped.length
      ? `Save ${mapped.length} positions → ${mappedAccounts} account${mappedAccounts === 1 ? "" : "s"} (${fmtUSD(mappedTotal)})`
      : "Nothing mapped — choose destinations";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Portfolio CSV Import</CardTitle>
        <p className="text-xs text-muted-foreground">
          Read-only. Upload your broker's Positions CSV export, or paste
          its text, then choose where each account imports to.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={10}
          placeholder="Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,..."
        />
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button onClick={() => fileRef.current?.click()}>Upload CSV file</Button>
          <Button onClick={preview} variant="secondary">
            Parse pasted text
          </Button>
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
              const subtotal = rows.reduce(
                (x, h) => x + (h.currentValue ?? h.quantity * h.current_price),
                0,
              );
              return (
                <div key={label} className="rounded-lg border">
                  <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 p-3">
                    <div className="min-w-40 flex-1">
                      <div className="text-sm font-medium">{label}</div>
                      <div className="text-xs text-muted-foreground">
                        {rows.length} positions · {fmtUSD(subtotal)}
                      </div>
                    </div>
                    <div className="w-64">
                      <Select
                        value={mapping[label]}
                        onValueChange={(v) => setMapping((m) => ({ ...m, [label]: v }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Import to…" />
                        </SelectTrigger>
                        <SelectContent>
                          {destinations.map((d) => (
                            <SelectItem key={d.value} value={d.value}>
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {mapping[label] !== SKIP && (
                    <table className="w-full text-xs">
                      <tbody>
                        {rows.slice(0, 6).map((h, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="p-2 font-medium">{h.symbol}</td>
                            <td className="text-right tabular-nums">{h.quantity}</td>
                            <td className="p-2 text-right tabular-nums">
                              {fmtUSD(h.currentValue ?? h.quantity * h.current_price)}
                            </td>
                          </tr>
                        ))}
                        {rows.length > 6 && (
                          <tr>
                            <td colSpan={3} className="p-2 text-muted-foreground">
                              + {rows.length - 6} more…
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
            {/* The "Overwrite entire portfolio" switch is gone (rule 29). It
                deleted every holding the user had, including accounts this
                import was not mapping and could not restore, and it defaulted
                to ON. Each mapped account is now replaced by its own atomic
                call and nothing else is touched — which is what the switch's
                own description claimed the OFF position did. */}
            <p className="rounded-lg border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
              Each account you map above is replaced by what this file says about it: positions in
              the file are added or updated, positions no longer in it are removed from that
              account, and <strong>accounts you skip are not touched at all</strong>. Your theses,
              notes and reviews are kept — only the broker&apos;s own figures are overwritten. If
              the file carries no cash line for an account, its cash balance is left as it is rather
              than set to zero.
            </p>
            <div className="flex items-center gap-2">
              <Label htmlFor="create-all" className="text-xs text-muted-foreground">
                Create accounts for everything in the file (529 / Crypto / IRA grouped on the
                Office)
              </Label>
              <Switch id="create-all" checked={createAll} onCheckedChange={onToggleCreateAll} />
            </div>
            <Button
              className="w-full"
              size="lg"
              onClick={() => void save()}
              disabled={busy || mapped.length === 0}
            >
              {saveLabel}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              Review each account&apos;s destination above, then save everything in one step.
              Skipped accounts are not touched.
            </p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          This app never connects to your broker and never places trades. Import is the only
          data path.
        </p>
      </CardContent>
    </Card>
  );
}

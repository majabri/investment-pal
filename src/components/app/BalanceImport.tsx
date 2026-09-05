// Paste-a-block balance import (Stage 2).
//
// Positions already import from a CSV; the balances beside them were four
// number boxes typed in by hand. This takes the block straight off Fidelity's
// balances page and shows exactly what it understood BEFORE anything is
// written — a partial parse is displayed as partial and can still be confirmed,
// but never silently completed with zeroes.
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAccountScope } from "@/contexts/AccountContext";
import { scopeIsEmpty, scopeLabel } from "@/lib/accountTotals";
import {
  accountPatch,
  parseBalanceBlock,
  toSnapshot,
  BALANCE_FIELD_LABELS,
  BALANCE_FIELD_ORDER,
  type BalanceFieldKey,
} from "@/lib/balanceImport";
import { fmtUSD } from "@/lib/finance";
import { useIpsLite, useRecordBalanceImport } from "@/hooks/useAppData";
import { marginRateLabel } from "@/lib/marginCost";
import { localIsoDate } from "@/lib/localDate";

/** Percentages print as percentages; everything else is money. */
function displayValue(key: BalanceFieldKey, value: number): string {
  if (key === "equityPct") return `${value.toFixed(2)}%`;
  if (key === "marginInterestRatePct") return `${value}%`;
  if (key === "netDebit") return `−${fmtUSD(value)}`; // shown the way Fidelity prints it
  return fmtUSD(value);
}

export function BalanceImport() {
  const scope = useAccountScope();
  const scopeName = scopeLabel(scope);
  const record = useRecordBalanceImport();
  const { data: ips, save: saveIps } = useIpsLite();
  const [raw, setRaw] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  // Setting the IPS margin rate is a separate, separately-ticked decision. The
  // rate is policy (ADR-APP-007) and money-adjacent (OD-001), so it does not
  // ride along inside "import my balances" — it is its own line item, showing
  // the exact value and the date it would be recorded as verified.
  const [adoptRate, setAdoptRate] = useState(true);

  // Parsing is pure and instant, so the preview is live — there is no "parse"
  // button whose result could go stale against an edited textarea.
  const parse = useMemo(() => parseBalanceBlock(raw), [raw]);
  const patch = useMemo(() => accountPatch(parse.fields), [parse]);

  // The rate the paste carries, offered only when it is actually different
  // from what IPS already holds. Re-confirming an identical rate would just
  // move its as-of date forward, which claims a verification that adds nothing.
  const pastedRate = parse.fields.marginInterestRatePct;
  const rateDiffers = pastedRate !== null && pastedRate !== ips.margin_rate_annual_pct;
  // The date the rate was observed at the broker, which is today — this paste
  // came off the balances page now. Stored as ADR-APP-007's verification date,
  // in the OWNER's calendar: the UTC date rolls over hours early west of
  // Greenwich, so an evening import would record itself as verified tomorrow,
  // which `rateStatus` then ages as a negative number of days.
  const rateAsOf = localIsoDate();

  const found = BALANCE_FIELD_ORDER.filter((k) => parse.fields[k] !== null);
  const partial = !parse.empty && parse.missing.length > 0;
  const canImport = scope.kind === "account" && !parse.empty && confirmed;

  const onImport = () => {
    if (scope.kind !== "account") return;
    record.mutate(
      { snapshot: toSnapshot(scope.accountId, parse, raw), patch },
      {
        onSuccess: () => {
          toast.success(`Balances recorded for ${scope.accountName}`);
          // Only after the balances are safely recorded, and only when the
          // rate line was ticked. A failure here leaves the import intact and
          // the old rate in place, which are both correct states.
          if (rateDiffers && adoptRate) {
            saveIps.mutate(
              { margin_rate_annual_pct: pastedRate, margin_rate_as_of: rateAsOf },
              {
                onSuccess: () => toast.success(`IPS margin rate set to ${pastedRate}%`),
                onError: (e) =>
                  toast.error(
                    `Balances saved, but the margin rate was not: ${(e as Error).message}`,
                  ),
              },
            );
          }
          setRaw("");
          setConfirmed(false);
          setAdoptRate(true);
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Import balances — {scopeName}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Copy the balances block from Fidelity and paste it here. Every figure it recognises is
          listed below before anything is saved, along with anything it could not find. Each import
          is kept, so the history builds up rather than overwriting itself.
        </p>

        {scopeIsEmpty(scope) ? (
          // Balances belong to one account. Importing without one selected
          // would have to guess which account they describe.
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            Select a single account first — a balance block describes one account, and there is no
            way to tell which one from the text.
          </p>
        ) : null}

        <Textarea
          rows={8}
          value={raw}
          placeholder={
            // Synthetic shape only. This placeholder is RENDERED IN THE BROWSER,
            // so it must never carry real balances (P0 remediation, 2026-09-05).
            "Total account value $128,450.00\nDay change +$1,234.56\nEquity percentage 86.50%\nNet debit −$20,000.00\n…"
          }
          onChange={(e) => {
            setRaw(e.target.value);
            // Editing the paste invalidates the confirmation. Otherwise a
            // confirmed preview could be imported after the text changed.
            setConfirmed(false);
          }}
          className="font-mono text-xs"
        />

        {raw.trim() && parse.empty ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            No balance figures found in that text. Nothing will be imported.
          </p>
        ) : null}

        {found.length > 0 ? (
          <div className="rounded-lg border">
            <div className="border-b px-3 py-2 text-xs font-medium">
              Understood {found.length} of {BALANCE_FIELD_ORDER.length} figures
            </div>
            <dl className="divide-y text-sm">
              {found.map((key) => (
                <div key={key} className="flex items-center justify-between px-3 py-1.5">
                  <dt className="text-muted-foreground">{BALANCE_FIELD_LABELS[key]}</dt>
                  <dd className="tabular font-medium">{displayValue(key, parse.fields[key]!)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {partial ? (
          // Named, not counted. "3 fields missing" cannot be checked against
          // the paste; a list of names can.
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            <span className="font-medium">Not found in the paste:</span>{" "}
            {parse.missing.map((k) => BALANCE_FIELD_LABELS[k]).join(", ")}. These will be recorded
            as unknown — not as zero, and no existing figure will be overwritten with one.
          </div>
        ) : null}

        {parse.unrecognised.length > 0 ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            <span className="font-medium">Lines with a figure but no recognised label:</span>
            <ul className="mt-1 list-inside list-disc font-mono text-xs">
              {parse.unrecognised.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs">
              These are not imported. If Fidelity has renamed a field, say so and the parser can
              learn the new label.
            </p>
          </div>
        ) : null}

        {!parse.empty && scope.kind === "account" ? (
          <div className="space-y-2">
            <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
              <span className="font-medium">This import will update {scope.accountName}:</span>{" "}
              {Object.keys(patch).length === 0
                ? "no live figures — the paste supplied none of cash, margin loan or buying power. The snapshot is still recorded."
                : Object.entries(patch)
                    .map(([k, v]) => `${k.replace(/_/g, " ")} → ${fmtUSD(v)}`)
                    .join(" · ")}
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5"
              />
              <span>These figures match my Fidelity balances page for {scope.accountName}.</span>
            </label>
            {/* The margin rate is IPS policy, not an account figure, so it is
                its own line item rather than part of the balances above. */}
            {rateDiffers ? (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={adoptRate}
                  onChange={(e) => setAdoptRate(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Also set the IPS margin rate to <span className="font-medium">{pastedRate}%</span>
                  , verified {rateAsOf}{" "}
                  <span className="text-muted-foreground">(currently {marginRateLabel(ips)})</span>.
                  This changes policy for the whole app, not just this account.
                </span>
              </label>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button size="sm" disabled={!canImport || record.isPending} onClick={onImport}>
            {record.isPending ? "Importing…" : "Import balances"}
          </Button>
          {raw.trim() ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRaw("");
                setConfirmed(false);
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

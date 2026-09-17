// Position tranches, read and written (§12.4, BR-010).
//
// #213 put the aggregate on the holdings table — "60 shares shown — 50 core +
// 10 tactical" — and left `useTranches` read-only because nothing could open
// or close one. This is that form. Opening records which part of a holding
// is which; closing records when a part ended. Neither touches the holding:
// the broker's figure is the broker's, and `coverageLines` says, per symbol,
// when the tranches and the holding disagree.
//
// Every figure shown is one `tranches.ts` computes; every sentence is one
// `tranchesView.ts` writes. The panel decides layout.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Field } from "@/components/app/Field";
import type { Account, Holding } from "@/hooks/useAppData";
import { useCloseTranche, useOpenTranche } from "@/hooks/useAppData";
import { fmtPrice } from "@/lib/finance";
import { localIsoMinute } from "@/lib/fillDraft";
import { closeRejection, emptyTrancheDraft, validateTrancheDraft } from "@/lib/trancheDraft";
import type { TrancheDraft, TrancheProblem } from "@/lib/trancheDraft";
import type { Tranche, TrancheKind } from "@/lib/tranches";
import { isOpen } from "@/lib/tranches";
import { TRANCHE_KINDS, unreadableNote } from "@/lib/trancheRows";
import type { TrancheRead } from "@/lib/trancheRows";
import {
  KIND_LABEL,
  coverageLines,
  fmtQuantity,
  sortTranches,
  trancheSummary,
} from "@/lib/tranchesView";

const fmtWhen = (iso: string): string => new Date(iso).toLocaleDateString("en-US");

export function TranchesPanel({
  account,
  read,
  holdings,
}: {
  /** NULL when no single account is in scope — a tranche belongs to one account. */
  account: Account | null;
  /** Undefined while loading. */
  read: TrancheRead | undefined;
  holdings: Holding[];
}) {
  const [opening, setOpening] = useState(false);
  // Which tranche has its close form open. One at a time, as with fills.
  const [closingId, setClosingId] = useState<string | null>(null);

  // Only this account's holdings: `useScopedHoldings` also carries unassigned
  // rows, and a tranche in this account for a holding in no account would
  // record a relationship nobody stated.
  const mine = useMemo(
    () => (account ? holdings.filter((h) => h.account_id === account.id) : []),
    [holdings, account],
  );

  if (account === null) {
    return (
      <div className="rounded-2xl border bg-card p-5">
        <div className="mb-1 text-sm font-medium">Position tranches</div>
        <p className="text-sm text-muted-foreground">
          Select a single account to see its tranches. A tranche belongs to one account, not to
          the household.
        </p>
      </div>
    );
  }

  if (read === undefined) {
    return (
      <div className="rounded-2xl border bg-card p-5">
        <div className="mb-1 text-sm font-medium">Position tranches</div>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const short = unreadableNote(read);
  const lines = coverageLines(mine, read.tranches);
  const sorted = sortTranches(read.tranches);

  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Position tranches</span>
        <span className="text-xs text-muted-foreground">{account.name}</span>
      </div>
      <p className="mb-1 text-xs text-muted-foreground">{trancheSummary(mine, read.tranches)}</p>
      {short && (
        <p className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {short}
        </p>
      )}
      {lines.length > 0 && (
        // Per symbol, and only where there is something to say. A matched
        // holding gets no line.
        <ul className="mb-3 space-y-1 text-xs text-muted-foreground">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}

      {sorted.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Opened</TableHead>
                <TableHead className="text-right">Opened qty</TableHead>
                <TableHead className="text-right">Target</TableHead>
                <TableHead>Invalidation</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((t) => (
                <TrancheRow
                  key={t.id}
                  tranche={t}
                  closing={closingId === t.id}
                  onClose={() => setClosingId(t.id)}
                  onDone={() => setClosingId(null)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-3">
        {opening ? (
          <TrancheForm account={account} holdings={mine} onDone={() => setOpening(false)} />
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpening(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Open a tranche
          </Button>
        )}
      </div>
    </div>
  );
}

function TrancheRow({
  tranche,
  closing,
  onClose,
  onDone,
}: {
  tranche: Tranche;
  closing: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [closedAt, setClosedAt] = useState(() => localIsoMinute());
  const close = useCloseTranche();
  const rejection = closing ? closeRejection(tranche, closedAt) : null;

  const submit = () => {
    if (rejection !== null) return;
    close.mutate(
      { tranche, closedAt },
      {
        onSuccess: () => {
          toast.success(
            `${tranche.symbol} ${KIND_LABEL[tranche.kind].toLowerCase()} tranche closed. Its opened quantity is kept — what remained is the fills' record.`,
          );
          onDone();
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  return (
    <>
      <TableRow>
        <TableCell className="font-medium">{tranche.symbol}</TableCell>
        <TableCell>{KIND_LABEL[tranche.kind]}</TableCell>
        <TableCell>{fmtWhen(tranche.opened_at)}</TableCell>
        <TableCell className="text-right tabular">{fmtQuantity(tranche.opened_quantity)}</TableCell>
        <TableCell className="text-right tabular">
          {tranche.target === null ? "—" : fmtPrice(tranche.target)}
        </TableCell>
        <TableCell className="max-w-[16rem] truncate text-muted-foreground">
          {tranche.invalidation ?? "—"}
        </TableCell>
        <TableCell>
          {isOpen(tranche) ? "Open" : `Closed ${fmtWhen(tranche.closed_at as string)}`}
        </TableCell>
        <TableCell className="text-right">
          {isOpen(tranche) && !closing && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onClose}
              aria-label={`Close the ${tranche.symbol} ${KIND_LABEL[tranche.kind].toLowerCase()} tranche`}
            >
              Close
            </Button>
          )}
        </TableCell>
      </TableRow>
      {closing && (
        <TableRow>
          <TableCell colSpan={8}>
            <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
              <Field label={`When the ${tranche.symbol} tranche closed`}>
                <Input
                  type="datetime-local"
                  max={localIsoMinute()}
                  value={closedAt}
                  onChange={(e) => setClosedAt(e.target.value)}
                  aria-invalid={rejection !== null}
                />
              </Field>
              <Button
                size="sm"
                onClick={submit}
                disabled={rejection !== null || close.isPending}
                aria-label={`Confirm closing the ${tranche.symbol} tranche`}
              >
                Close tranche
              </Button>
              <Button size="sm" variant="ghost" onClick={onDone} aria-label="Cancel closing this tranche">
                <X className="mr-1 h-4 w-4" />
                Cancel
              </Button>
              {rejection && (
                <p className="basis-full text-[11px] text-amber-600 dark:text-amber-400">{rejection}</p>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function TrancheForm({
  account,
  holdings,
  onDone,
}: {
  account: Account;
  holdings: Holding[];
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<TrancheDraft>(() => emptyTrancheDraft());
  const open = useOpenTranche();
  const listId = `tranche-symbols-${account.id}`;

  const problems = useMemo(() => validateTrancheDraft(draft), [draft]);
  const problemFor = (field: TrancheProblem["field"]) =>
    problems.find((p) => p.field === field)?.message ?? null;
  // Shown once the holder has typed something, so an untouched form is not
  // covered in red before they have done anything wrong.
  const touched = draft.symbol !== "" || draft.quantity !== null || draft.kind !== null;

  const submit = () => {
    if (problems.length > 0) return;
    open.mutate(
      { accountId: account.id, draft },
      {
        onSuccess: () => {
          toast.success(
            `${draft.symbol.trim().toUpperCase()} tranche opened. The holding is unchanged — the line above says whether the tranches match it.`,
          );
          onDone();
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const num = (v: string): number | null => (v === "" ? null : +v);

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="mb-2 text-xs font-medium">Open a tranche in {account.name}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Symbol">
          <Input
            list={listId}
            placeholder="held symbol"
            autoCapitalize="characters"
            value={draft.symbol}
            onChange={(e) => setDraft({ ...draft, symbol: e.target.value })}
            aria-invalid={touched && problemFor("symbol") !== null}
          />
        </Field>
        {/* A datalist, not a select: a tranche can be recorded for a symbol
            that is not yet in the holdings (the position was opened before
            the import), and the coverage line will say so. */}
        <datalist id={listId}>
          {holdings.map((h) => (
            <option key={h.id} value={h.symbol} />
          ))}
        </datalist>
        <Field label="Kind">
          <Select
            value={draft.kind ?? ""}
            onValueChange={(v) => setDraft({ ...draft, kind: v as TrancheKind })}
          >
            <SelectTrigger aria-invalid={touched && problemFor("kind") !== null}>
              <SelectValue placeholder="core or tactical" />
            </SelectTrigger>
            <SelectContent>
              {TRANCHE_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="When it opened">
          <Input
            type="datetime-local"
            max={localIsoMinute()}
            value={draft.openedAt}
            onChange={(e) => setDraft({ ...draft, openedAt: e.target.value })}
            aria-invalid={touched && problemFor("openedAt") !== null}
          />
        </Field>
        <Field label="Quantity opened">
          <Input
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            placeholder="shares"
            value={draft.quantity ?? ""}
            onChange={(e) => setDraft({ ...draft, quantity: num(e.target.value) })}
            aria-invalid={touched && problemFor("quantity") !== null}
          />
        </Field>
        <Field label="Target price (blank if none)">
          <Input
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            placeholder="no target"
            value={draft.target ?? ""}
            onChange={(e) => setDraft({ ...draft, target: num(e.target.value) })}
            aria-invalid={touched && problemFor("target") !== null}
          />
        </Field>
        <Field label="Invalidation (optional)">
          <Input
            placeholder="what would make this wrong"
            value={draft.invalidation ?? ""}
            onChange={(e) => setDraft({ ...draft, invalidation: e.target.value || null })}
          />
        </Field>
        <Field label="Note (optional)" className="sm:col-span-2 lg:col-span-3">
          <Input
            placeholder="in your words"
            value={draft.note ?? ""}
            onChange={(e) => setDraft({ ...draft, note: e.target.value || null })}
          />
        </Field>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Core and tactical tranches in one symbol show as one holding and close separately. Opening
        a tranche changes nothing about the holding; the line above says whether they match.
      </p>
      {touched && problems.length > 0 ? (
        <ul className="mt-2 space-y-1 text-[11px] text-amber-600 dark:text-amber-400">
          {problems.map((p) => (
            <li key={`${p.field}-${p.message}`}>{p.message}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={submit}
          disabled={problems.length > 0 || open.isPending}
          aria-label="Open this tranche"
        >
          <Plus className="mr-1 h-4 w-4" />
          Open tranche
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} aria-label="Cancel opening a tranche">
          <X className="mr-1 h-4 w-4" />
          Cancel
        </Button>
      </div>
    </div>
  );
}

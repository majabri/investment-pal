// The margin loan, editable in place. Fidelity's positions export never
// includes the debit, so this is the one number entered by hand — make
// entering it effortless and unmistakable.
import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { fmtUSD } from "@/lib/finance";
import { useIpsLite } from "@/hooks/useAppData";
import { marginRateLabel } from "@/lib/marginCost";

export function MarginCard({
  accountId,
  marginUsed,
}: {
  /** A resolved account is required. This used to accept null and create an
   *  account named after whatever label the caller passed — which, once the
   *  caller became the account switcher, meant saving with nothing selected
   *  would create an account literally named "—" and attach a margin loan to
   *  it. Callers must not render this card without a resolved account. */
  accountId: string;
  /**
   * The margin debit, or NULL when the account does not know it (Phase 1a).
   *
   * NULL and 0 read differently and are fixed differently: NULL means nobody
   * has recorded a loan, 0 means the broker reported none. This card showed
   * "Not set" for both, so an account the broker confirmed carries no margin
   * was indistinguishable from one whose loan has never been entered.
   */
  marginUsed: number | null;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(marginUsed === null ? "" : String(marginUsed));
  const [busy, setBusy] = useState(false);
  const { data: ipsLite } = useIpsLite();

  async function save() {
    const n = parseFloat(val.replace(/[$,]/g, ""));
    if (!Number.isFinite(n) || n < 0) {
      toast.error("Enter the margin debit as a number, e.g. 23119.31");
      return;
    }
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase
        .from("accounts")
        .update({
          margin_used: n,
          // Provenance travels with the figure (Phase 1d, rule 14).
          balances_source_type: "user_entry",
          balances_source: "margin_card",
          balances_as_of: new Date().toISOString(),
        })
        .eq("id", accountId);
      if (error) throw error;
      toast.success(`Margin loan set: ${fmtUSD(n)}`);
      setEditing(false);
      void qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Margin loan</span>
        {!editing && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5"
            onClick={() => {
              setVal(marginUsed === null ? "" : String(marginUsed));
              setEditing(true);
            }}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
      {editing ? (
        <div className="mt-1 flex items-center gap-2">
          <Input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder="23119.31"
            className="h-8 tabular"
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <Button size="sm" className="h-8" disabled={busy} onClick={() => void save()}>
            {busy ? "…" : "Save"}
          </Button>
        </div>
      ) : (
        <>
          <div
            className={`mt-1 text-xl font-semibold tabular ${marginUsed !== null && marginUsed > 0 ? "" : "text-muted-foreground"}`}
          >
            {marginUsed === null
              ? "Not known — click ✎"
              : marginUsed > 0
                ? fmtUSD(marginUsed)
                : "No margin loan"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {marginUsed === null
              ? "From your broker's balances page — the credit balance, as a positive number"
              : marginUsed > 0
                ? `Owed to your broker — ${marginRateLabel(ipsLite)}`
                : "Recorded as zero — the broker reported no loan on this account"}
          </div>
        </>
      )}
    </div>
  );
}

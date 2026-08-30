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

export function MarginCard({ accountId, marginUsed }: {
  /** A resolved account is required. This used to accept null and create an
   *  account named after whatever label the caller passed — which, once the
   *  caller became the account switcher, meant saving with nothing selected
   *  would create an account literally named "—" and attach a margin loan to
   *  it. Callers must not render this card without a resolved account. */
  accountId: string;
  marginUsed: number;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(marginUsed || ""));
  const [busy, setBusy] = useState(false);

  async function save() {
    const n = parseFloat(val.replace(/[$,]/g, ""));
    if (!Number.isFinite(n) || n < 0) { toast.error("Enter the margin debit as a number, e.g. 23119.31"); return; }
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.from("accounts").update({ margin_used: n }).eq("id", accountId);
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
          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => { setVal(String(marginUsed || "")); setEditing(true); }}>
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
      {editing ? (
        <div className="mt-1 flex items-center gap-2">
          <Input autoFocus value={val} onChange={(e) => setVal(e.target.value)}
            placeholder="23119.31" className="h-8 tabular"
            onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }} />
          <Button size="sm" className="h-8" disabled={busy} onClick={() => void save()}>{busy ? "…" : "Save"}</Button>
        </div>
      ) : (
        <>
          <div className={`mt-1 text-xl font-semibold tabular ${marginUsed > 0 ? "" : "text-muted-foreground"}`}>
            {marginUsed > 0 ? fmtUSD(marginUsed) : "Not set — click ✎"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {marginUsed > 0 ? "Owed to Fidelity at 11.825% APR" : "From Fidelity → Balances → Cash & Credits (as a positive number)"}
          </div>
        </>
      )}
    </div>
  );
}

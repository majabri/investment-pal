// Per-holding investment memory: thesis, why we own it, notes, sector.
import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabaseClient";

interface H { id: string; symbol: string; sector: string | null;
  original_thesis: string | null; current_thesis: string | null;
  why_own: string | null; notes: string | null; last_reviewed_at?: string | null; }

export function ThesisDialog({ holding }: { holding: H }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    sector: holding.sector ?? "",
    original_thesis: holding.original_thesis ?? "",
    current_thesis: holding.current_thesis ?? "",
    why_own: holding.why_own ?? "",
    notes: holding.notes ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const hasThesis = !!(holding.current_thesis || holding.original_thesis || holding.why_own);

  async function save() {
    const { error } = await supabase.from("holdings").update({
      sector: f.sector || null,
      original_thesis: f.original_thesis || null,
      current_thesis: f.current_thesis || null,
      why_own: f.why_own || null,
      notes: f.notes || null,
      last_reviewed_at: new Date().toISOString(),
    }).eq("id", holding.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${holding.symbol} thesis saved`);
    setOpen(false);
    void qc.invalidateQueries({ queryKey: ["holdings"] });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className={hasThesis ? "text-primary" : "text-muted-foreground"}>
          <FileText className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{holding.symbol} — investment memory</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Sector</Label>
            <Input value={f.sector} onChange={set("sector")} placeholder="e.g. Cybersecurity" />
          </div>
          <div>
            <Label className="text-xs">Original thesis (why bought)</Label>
            <Textarea rows={2} value={f.original_thesis} onChange={set("original_thesis")} />
          </div>
          <div>
            <Label className="text-xs">Current thesis</Label>
            <Textarea rows={2} value={f.current_thesis} onChange={set("current_thesis")} />
          </div>
          <div>
            <Label className="text-xs">Why we own it</Label>
            <Textarea rows={2} value={f.why_own} onChange={set("why_own")} />
          </div>
          <div>
            <Label className="text-xs">Personal notes</Label>
            <Textarea rows={2} value={f.notes} onChange={set("notes")} />
          </div>
          <Button className="w-full" onClick={() => void save()}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

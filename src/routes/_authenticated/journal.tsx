import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Search, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

import { AppShell } from "@/components/app/AppShell";
import { LearningLog } from "@/components/app/LearningLog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useJournal, useAddJournal, type JournalEntry } from "@/hooks/useAppData";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/journal")({
  head: () => ({
    meta: [
      { title: "Journal — Investment Companion" },
      { name: "description", content: "Searchable investment history and lessons." },
    ],
  }),
  component: JournalPage,
});

const TYPES: JournalEntry["entry_type"][] = [
  "note",
  "morning_review",
  "eod_review",
  "trade",
  "ai_summary",
  "lesson",
  "decision",
];

const TYPE_LABEL: Record<JournalEntry["entry_type"], string> = {
  note: "Note",
  morning_review: "Morning",
  eod_review: "EOD",
  trade: "Trade",
  ai_summary: "AI",
  lesson: "Lesson",
  decision: "Decision",
};

function JournalPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const { data: entries = [] } = useJournal(search);
  const add = useAddJournal();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<JournalEntry["entry_type"]>("note");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tickers, setTickers] = useState("");
  const [selected, setSelected] = useState<JournalEntry | null>(null);

  const submit = () => {
    if (!body.trim()) return toast.error("Body required");
    add.mutate(
      {
        entry_type: type,
        title: title || undefined,
        body,
        tickers: tickers.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
      },
      {
        onSuccess: () => {
          toast.success("Saved");
          setOpen(false);
          setTitle("");
          setBody("");
          setTickers("");
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const del = async (id: string) => {
    if (!confirm("Delete entry?")) return;
    const { error } = await supabase.from("journal_entries").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["journal"] });
    setSelected(null);
  };

  return (
    <AppShell
      title="Journal"
      subtitle="Permanent history of reviews, trades, decisions, and lessons."
      actions={
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New entry
        </Button>
      }
    >
      <div className="mb-4 flex items-center gap-2 rounded-xl border bg-card px-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title or body…"
          className="border-0 bg-transparent focus-visible:ring-0"
        />
      </div>

      {entries.length === 0 ? (
        <p className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
          {search ? "No matches." : "No entries yet. Add your first note or use the Prompt Center."}
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li
              key={e.id}
              className="cursor-pointer rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
              onClick={() => setSelected(e)}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-primary/30 text-primary">
                      {TYPE_LABEL[e.entry_type]}
                    </Badge>
                    {e.tickers.map((t) => (
                      <Badge key={t} variant="secondary">
                        {t}
                      </Badge>
                    ))}
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  {e.title ? <div className="mt-1 font-medium">{e.title}</div> : null}
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{e.body}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>New journal entry</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as JournalEntry["entry_type"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Title (optional)</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Tickers (comma-separated)</Label>
              <Input value={tickers} onChange={(e) => setTickers(e.target.value)} placeholder="AAPL, NVDA" />
            </div>
            <div>
              <Label className="text-xs">Body</Label>
              <Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <Button className="w-full" onClick={submit}>
              Save entry
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.title || TYPE_LABEL[selected.entry_type]}</SheetTitle>
              </SheetHeader>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="border-primary/30 text-primary">
                  {TYPE_LABEL[selected.entry_type]}
                </Badge>
                {selected.tickers.map((t) => (
                  <Badge key={t} variant="secondary">
                    {t}
                  </Badge>
                ))}
                <span>{new Date(selected.created_at).toLocaleString()}</span>
              </div>
              <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-background p-3 text-sm">
{selected.body}
              </pre>
              {selected.ai_summary ? (
                <>
                  <div className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">
                    AI summary
                  </div>
                  <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-background p-3 text-sm">
{selected.ai_summary}
                  </pre>
                </>
              ) : null}
              <Button variant="outline" className="mt-6" onClick={() => del(selected.id)}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </Button>
            </>
          )}
        </SheetContent>
      </Sheet>
          <div className="mt-4"><LearningLog /></div>
    </AppShell>
  );
}

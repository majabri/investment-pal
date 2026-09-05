// Embedded Investment Committee chat. The generated prompt seeds the
// system message; every exchange stays grounded in verified data.
import { useState } from "react";
import { chatFn, type ChatMsg } from "@/lib/chatServer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function CommitteeChat({
  systemPrompt,
  title = "Committee Chat",
}: {
  systemPrompt: string;
  title?: string;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    const next: ChatMsg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    const res = await chatFn({
      data: { messages: [{ role: "system", content: systemPrompt }, ...next] },
    });
    setMessages([...next, { role: "assistant", content: res.content }]);
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        {messages.length === 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              send("Run the full review now using the mandate and data in your instructions.")
            }
            disabled={busy}
          >
            {busy ? "Running…" : "Run full review"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-96 space-y-3 overflow-y-auto">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              The committee is seeded with today&apos;s full prompt and your verified data. Ask
              anything, or run the full review.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                m.role === "user" ? "ml-8 bg-primary/10" : "mr-4 bg-muted",
              )}
            >
              {m.content}
            </div>
          ))}
          {busy && <p className="text-sm text-muted-foreground">Committee deliberating…</p>}
        </div>
        <div className="flex gap-2">
          <Textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Ask the committee…"
          />
          <Button onClick={() => void send()} disabled={busy}>
            Send
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

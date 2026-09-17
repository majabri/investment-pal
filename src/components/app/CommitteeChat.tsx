// The Investment Committee, in the app (§5.1, §22.1).
//
// The generated brief seeds the system message; the conversation runs here,
// against the app's own AI backend; and when the review is done the action
// sheet is asked for as data, shown for confirmation, and recorded through the
// decision write path with its versions stamped. Nothing is copied out to
// another window and nothing is pasted back in.
//
// One deliberate fallback remains and it is not a workflow: when the server
// reports no AI key, the brief can be copied. That state is an error, says so,
// and names what to configure.
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { chatFn, extractDecisionsFn, NO_KEY_MESSAGE, type ChatMsg } from "@/lib/chatServer";
import type { CommitteeOutput } from "@/lib/committeeContract";
import { mayRecord } from "@/lib/committeeDecisions";
import { parseAction } from "@/lib/decisionEvidence";
import type { MeetingType } from "@/lib/prompts";
import type { GateVerdict } from "@/lib/readinessGate";
import { gateCaveat } from "@/lib/readinessGate";
import { MAX_CHAT_MESSAGES } from "@/lib/serverInput";
import { cn } from "@/lib/utils";

/** How many recent turns go with the system message. One slot is the server's instruction. */
const HISTORY_WINDOW = MAX_CHAT_MESSAGES - 2;

export function CommitteeChat({
  systemPrompt,
  meeting,
  title,
  verdict,
  onRecord,
  onSaveTranscript,
  recording = false,
}: {
  systemPrompt: string;
  /** Names the brief. Required when decisions are recorded; it becomes the review type. */
  meeting?: MeetingType;
  /** Overrides the header. The IRA and family committees name themselves. */
  title?: string;
  /**
   * The readiness gate's verdict for this account, and the record path. Both
   * or neither: a surface that supplies them can record an action sheet; one
   * that does not is conversation only, and the button is absent rather than
   * disabled — there is nothing it could honestly do.
   */
  verdict?: GateVerdict;
  onRecord?: (output: CommitteeOutput, modelVersion: string | null) => Promise<void>;
  onSaveTranscript?: (transcript: string) => void;
  recording?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [pending, setPending] = useState<{ output: CommitteeOutput; model: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noKey, setNoKey] = useState(false);

  const recordable = verdict !== undefined && onRecord !== undefined && meeting !== undefined;
  const canRecord = recordable && mayRecord(verdict);
  const caveat = verdict ? gateCaveat(verdict) : null;
  const heading = title ?? `Investment Committee — ${meeting ?? "Review"}`;
  const hasReview = messages.some((m) => m.role === "assistant");

  const withSystem = (history: ChatMsg[]): ChatMsg[] => [
    { role: "system", content: systemPrompt },
    ...history.slice(-HISTORY_WINDOW),
  ];

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    const next: ChatMsg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    const res = await chatFn({ data: { messages: withSystem(next) } });
    setBusy(false);
    if (!res.ok) {
      // The user's turn stays in the transcript; the failure is shown beside
      // it rather than as a fake assistant message that later gets recorded.
      setError(res.content);
      if (res.content === NO_KEY_MESSAGE) setNoKey(true);
      return;
    }
    setMessages([...next, { role: "assistant", content: res.content }]);
  }

  async function prepareActionSheet() {
    if (extracting || !hasReview || !recordable) return;
    setExtracting(true);
    setError(null);
    const res = await extractDecisionsFn({ data: { messages: withSystem(messages) } });
    setExtracting(false);
    if (!res.ok) {
      setError(res.content);
      return;
    }
    setPending({ output: res.output, model: res.model });
  }

  async function record() {
    if (!pending || recording || !onRecord) return;
    await onRecord(pending.output, pending.model);
    setPending(null);
  }

  const transcript = useMemo(
    () =>
      messages
        .map((m) => `${m.role === "user" ? "YOU" : "COMMITTEE"}:\n${m.content}`)
        .join("\n\n"),
    [messages],
  );

  const copyBrief = async () => {
    await navigator.clipboard.writeText(systemPrompt);
    toast.success("Brief copied");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{heading}</CardTitle>
        <div className="flex flex-wrap gap-2">
          {!hasReview && (
            <Button
              size="sm"
              onClick={() =>
                send("Run the full review now using the mandate and data in your instructions.")
              }
              disabled={busy || noKey}
            >
              {busy ? "Running…" : "Run full review"}
            </Button>
          )}
          {hasReview && !pending && recordable && (
            <Button size="sm" onClick={() => void prepareActionSheet()} disabled={extracting || busy}>
              {extracting ? "Preparing…" : "Prepare action sheet"}
            </Button>
          )}
          {hasReview && onSaveTranscript && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSaveTranscript(transcript)}
              aria-label="Save this conversation to the journal"
            >
              Save transcript to Journal
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* The gate's verdict, where the recommendation is made (§21.3). */}
        {caveat && (
          <p
            className={cn(
              "rounded-lg border px-3 py-2 text-xs",
              canRecord ? "border-amber-500/40 bg-amber-500/5" : "border-destructive/40 bg-destructive/5 text-destructive",
            )}
          >
            {caveat}
            {canRecord
              ? " Decisions can still be recorded; this caveat is attached to each as its first risk."
              : " Decisions from this review cannot be recorded until the inputs are verified."}
          </p>
        )}

        {noKey ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm">
            <p className="text-destructive">{NO_KEY_MESSAGE}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Until a key is configured the committee cannot run here. The brief it would have
              received can be copied — that is a fallback, not the workflow.
            </p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => void copyBrief()}>
              Copy the brief
            </Button>
          </div>
        ) : (
          <>
            <div className="max-h-[32rem] space-y-3 overflow-y-auto">
              {messages.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  The committee has the {meeting ? `${meeting.toLowerCase()} ` : ""}brief and your
                  verified data. Run the full review, or ask it something first.
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
              {error && (
                <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>

            {pending && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="mb-2 text-xs font-medium">
                  Action sheet — {pending.output.decisions.length} decision
                  {pending.output.decisions.length === 1 ? "" : "s"} to record as pending
                  {pending.model ? ` · ${pending.model}` : ""}
                </div>
                <ul className="space-y-1 text-sm">
                  {pending.output.decisions.map((dec, i) => {
                    const a = parseAction(dec.action);
                    return (
                      <li key={i} className="flex flex-wrap gap-x-2">
                        <span className="font-mono text-xs">
                          {a?.value ?? dec.action}
                          {a && !a.inContract ? " (off-contract)" : ""}
                        </span>
                        <span className="font-medium">{dec.symbol ?? "portfolio"}</span>
                        <span className="text-muted-foreground">{dec.recommendation}</span>
                        {dec.confidence !== null && (
                          <span className="text-xs text-muted-foreground">
                            conf {Math.round(dec.confidence * 100)}%
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {pending.output.cio_summary && (
                  <p className="mt-2 text-xs text-muted-foreground">{pending.output.cio_summary}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void record()} disabled={!canRecord || recording}>
                    {recording ? "Recording…" : `Record ${pending.output.decisions.length} as pending`}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPending(null)} disabled={recording}>
                    Discard
                  </Button>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Textarea
                id="committee-input"
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
                aria-label="Message the committee"
              />
              <Button onClick={() => void send()} disabled={busy}>
                Send
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

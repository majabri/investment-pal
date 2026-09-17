// The in-app committee — an OpenAI-compatible backend, server-side only.
//
// Set ONE of these in the hosting environment (never in code):
//   OPENAI_API_KEY  → api.openai.com, model gpt-4o
//   LOVABLE_API_KEY → Lovable AI gateway, model openai/gpt-5-mini
//
// Two functions. `chatFn` is the conversation. `extractDecisionsFn` is asked
// afterwards, over the same conversation, for the FINAL CIO ACTION SHEET as
// JSON — and returns it only if it fits the contract. The model's reply is
// parsed and validated here, on the server, so a client never receives a
// decision list it would have to trust.
//
// The model id is returned with every answer. It is what `model_version` on
// a decision row is stamped from (DEC-003) — the provider's own word for what
// answered, never the model's claim about itself.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EXTRACTION_INSTRUCTION, parseCommitteeJson } from "./committeeContract";
import type { CommitteeOutput } from "./committeeContract";
import { MAX_CHAT_MESSAGES, chatInputSchema } from "./serverInput";
import { enforceProviderRateLimit } from "./serverRateLimit";

export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ChatResult =
  | { ok: true; content: string; model: string }
  | { ok: false; content: string; model: null };

/** The message the client shows, verbatim, when no key is configured. */
export const NO_KEY_MESSAGE =
  "No AI key is configured. Add OPENAI_API_KEY or LOVABLE_API_KEY in the hosting environment settings and reload.";

function providerConfig(): { url: string; key: string; model: string; direct: boolean } | null {
  const openai = process.env.OPENAI_API_KEY;
  const lovable = process.env.LOVABLE_API_KEY;
  if (openai) {
    return { url: "https://api.openai.com/v1/chat/completions", key: openai, model: "gpt-4o", direct: true };
  }
  if (lovable) {
    return {
      url: "https://ai.gateway.lovable.dev/v1/chat/completions",
      key: lovable,
      model: "openai/gpt-5-mini",
      direct: false,
    };
  }
  return null;
}

async function complete(messages: ChatMsg[], opts: { json: boolean }): Promise<ChatResult> {
  const cfg = providerConfig();
  if (!cfg) return { ok: false, content: NO_KEY_MESSAGE, model: null };
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        max_tokens: opts.json ? 4000 : 2000,
        // JSON mode is an OpenAI feature; the gateway is asked by instruction.
        ...(opts.json && cfg.direct ? { response_format: { type: "json_object" }, temperature: 0 } : {}),
      }),
    });
    if (!res.ok) {
      return {
        ok: false,
        content: `The AI provider answered ${res.status}. Check the key and billing in the hosting environment.`,
        model: null,
      };
    }
    const j = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
    };
    const content = j?.choices?.[0]?.message?.content ?? "";
    return { ok: true, content: content || "(empty response)", model: j?.model ?? cfg.model };
  } catch {
    return { ok: false, content: "Could not reach the AI provider — network or key issue.", model: null };
  }
}

export const chatFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => chatInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ChatResult> => {
    await enforceProviderRateLimit(context.supabase, "chat");
    return complete(data.messages, { json: false });
  });

export type ExtractResult =
  | { ok: true; output: CommitteeOutput; model: string }
  | { ok: false; content: string; model: null };

/**
 * The action sheet as data. Appends the extraction instruction to the
 * conversation the client sends; the client is responsible for sending the
 * system message plus the most recent turns, within `MAX_CHAT_MESSAGES`.
 */
export const extractDecisionsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => chatInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ExtractResult> => {
    await enforceProviderRateLimit(context.supabase, "chat");
    // Room for the instruction: the validator caps the caller's list, and
    // one more message is appended here.
    const history = data.messages.slice(-(MAX_CHAT_MESSAGES - 1));
    const messages: ChatMsg[] = [...history, { role: "user", content: EXTRACTION_INSTRUCTION }];
    const res = await complete(messages, { json: true });
    if (!res.ok) return res;
    const parsed = parseCommitteeJson(res.content);
    if (!parsed.ok) return { ok: false, content: parsed.reason, model: null };
    return { ok: true, output: parsed.output, model: res.model };
  });

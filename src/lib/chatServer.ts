// In-app committee chat — provider-agnostic OpenAI-compatible backend.
// Set ONE of these env vars in your hosting settings (never in code):
//   OPENAI_API_KEY  → api.openai.com (model: gpt-4o by default)
//   LOVABLE_API_KEY → Lovable AI gateway (model: openai/gpt-5-mini default)
// The app never stores keys client-side; this runs server-side only.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chatInputSchema } from "./serverInput";
import { enforceProviderRateLimit } from "./serverRateLimit";

export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

export const chatFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => chatInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; content: string }> => {
    await enforceProviderRateLimit(context.supabase, "chat");
    const openai = process.env.OPENAI_API_KEY;
    const lovable = process.env.LOVABLE_API_KEY;
    const key = openai ?? lovable;
    if (!key) {
      return {
        ok: false,
        content:
          "No AI key configured. Add OPENAI_API_KEY or LOVABLE_API_KEY in your hosting environment settings, then reload. Until then, use Copy Prompt + Open ChatGPT — same committee, manual transport.",
      };
    }
    const url = openai
      ? "https://api.openai.com/v1/chat/completions"
      : "https://ai.gateway.lovable.dev/v1/chat/completions";
    const model = openai ? "gpt-4o" : "openai/gpt-5-mini";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: data.messages, max_tokens: 2000 }),
      });
      if (!res.ok)
        return {
          ok: false,
          content: `AI provider error (${res.status}). Check the key and billing, or use Copy Prompt + Open ChatGPT.`,
        };
      const j = await res.json();
      return { ok: true, content: j?.choices?.[0]?.message?.content ?? "(empty response)" };
    } catch {
      return { ok: false, content: "Could not reach the AI provider — network or key issue." };
    }
  });

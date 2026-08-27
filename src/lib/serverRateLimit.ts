import type { SupabaseClient } from "@supabase/supabase-js";

export type ProviderRateLimitScope = "chat" | "market" | "calendar" | "news";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
}

type RateLimitRpcClient = Pick<SupabaseClient, "rpc">;

export class ProviderRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`Too many requests. Try again in ${retryAfterSeconds} seconds.`);
    this.name = "ProviderRateLimitError";
  }
}

/**
 * Consumes a durable, per-user allowance before a server function calls an
 * external provider. The Postgres function owns all limits so callers cannot
 * choose a larger allowance.
 */
export async function enforceProviderRateLimit(
  supabase: RateLimitRpcClient,
  scope: ProviderRateLimitScope,
): Promise<void> {
  const { data, error } = await supabase.rpc(
    "consume_provider_request_limit" as never,
    {
      p_scope: scope,
    } as never,
  );

  if (error) {
    console.error("[RateLimit] Could not consume provider allowance", { scope, error });
    throw new Error("Request protection is temporarily unavailable. Please try again shortly.");
  }

  const result = Array.isArray(data) ? (data[0] as RateLimitResult | undefined) : undefined;
  if (!result) {
    console.error("[RateLimit] Provider allowance returned no result", { scope });
    throw new Error("Request protection is temporarily unavailable. Please try again shortly.");
  }

  if (!result.allowed) {
    throw new ProviderRateLimitError(result.retry_after_seconds);
  }
}

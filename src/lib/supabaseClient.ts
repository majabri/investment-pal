import { createClient } from "@supabase/supabase-js";

import { brokeredPreviewStorage } from "@/integrations/supabase/previewAuthStorage";
import type { Database as GeneratedDatabase } from "@/integrations/supabase/types";

// ---------------------------------------------------------------------------
// Temporary schema shim (pending migrations, 2026-09-08).
//
// The generated types reflect the LIVE database, which is behind the repo:
// the migrations under supabase/migrations/20260903*–20260905* create the
// tables household_members / strategies / strategy_symbols / orders /
// position_lots and add provenance + nullable columns to accounts and goals.
// Until they are applied and the generated types regenerate, the code that
// already targets the new schema cannot typecheck.
//
// 2026-09-10: account_balances landed and left this list — its generated type
// now governs those writes. accounts and goals stay loosened: their provenance
// and nullability migrations are still pending, and the generated types still
// show the financial columns as NOT NULL.
//
// This shim keeps SELECT row typing for existing tables, loosens writes on
// accounts/goals (new columns + NULL-as-unknown), and declares the pending
// tables loosely. Remove it once the migrations land and
// src/integrations/supabase/types.ts regenerates.
// ---------------------------------------------------------------------------
type GeneratedTables = GeneratedDatabase["public"]["Tables"];
type LooseWrite<Row> = {
  Row: Row;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: [];
};
type PendingTable = LooseWrite<Record<string, unknown>>;

type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedDatabase["public"], "Tables"> & {
    Tables: Omit<GeneratedTables, "accounts" | "goals"> & {
      accounts: LooseWrite<GeneratedTables["accounts"]["Row"]>;
      goals: LooseWrite<GeneratedTables["goals"]["Row"]>;
      household_members: PendingTable;
      strategies: PendingTable;
      strategy_symbols: PendingTable;
      orders: PendingTable;
      position_lots: PendingTable;
    };
  };
};

// Public browser configuration. The literals are intentional fallbacks for
// deployments where the build environment does not inject VITE_* values.
const backendUrl = import.meta.env.VITE_SUPABASE_URL || "https://odyfsvwvlkrgjodewsus.supabase.co";
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_R0i65KifBjXDEimENEeY9g_-95W0O3e";

function createBackendFetch(apiKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    }

    if (headers.get("Authorization") === `Bearer ${apiKey}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", apiKey);

    return fetch(input, { ...init, headers });
  };
}

export const supabase = createClient<Database>(backendUrl, publishableKey, {
  global: { fetch: createBackendFetch(publishableKey) },
  auth: {
    storage: brokeredPreviewStorage(),
    persistSession: true,
    autoRefreshToken: true,
  },
});

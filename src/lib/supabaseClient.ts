import { createClient } from "@supabase/supabase-js";

import { brokeredPreviewStorage } from "@/integrations/supabase/previewAuthStorage";
import type { Database } from "@/integrations/supabase/types";

// Public browser configuration. The literals are intentional fallbacks for
// deployments where the build environment does not inject VITE_* values.
const backendUrl = import.meta.env.VITE_SUPABASE_URL || 'https://odyfsvwvlkrgjodewsus.supabase.co';
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_R0i65KifBjXDEimENEeY9g_-95W0O3e';

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

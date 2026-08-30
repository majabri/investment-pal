// Project-specific bearer attacher for server-function RPCs.
//
// The generated `attachSupabaseAuth` reads `supabase.auth.getSession()` once.
// In the preview iframe (and right after a hard refresh) the session store can
// still be hydrating, so the very first serverFn call goes out with no
// Authorization header and `requireSupabaseAuth` throws
// "Unauthorized: No authorization header provided".
//
// This version briefly waits for the session to appear before giving up.
import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/lib/supabaseClient";

async function getAccessToken(): Promise<string | undefined> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) return token;
    await new Promise((r) => setTimeout(r, 150));
  }
  return undefined;
}

export const attachSupabaseAuthResilient = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const token = typeof window === "undefined" ? undefined : await getAccessToken();
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
);

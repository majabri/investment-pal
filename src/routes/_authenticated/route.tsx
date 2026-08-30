import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/lib/supabaseClient";
import { AccountProvider } from "@/contexts/AccountContext";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  // Account selection is shell-level state: every authenticated screen reads
  // the same selected account instead of re-deriving it from a name (PR-UI-2).
  component: () => (
    <AccountProvider>
      <Outlet />
    </AccountProvider>
  ),
});

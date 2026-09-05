// Explicit state for "we cannot resolve which account you mean" (PR-UI-2).
//
// This replaces a silent fallback to accountless holdings. Rendering a
// plausible-but-wrong portfolio value on a screen used to make real money
// decisions is the worst available outcome, so the app now says nothing rather
// than guessing. Wrong numbers are worse than no numbers.
import { AlertTriangle, Wallet } from "lucide-react";
import { Link } from "@tanstack/react-router";

import type { AccountStatus } from "@/contexts/AccountContext";

export function AccountNotice({ status }: { status: AccountStatus }) {
  if (status === "ready" || status === "loading") return null;

  const unresolved = status === "unresolved";
  const Icon = unresolved ? AlertTriangle : Wallet;

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <div className="text-sm">
        <div className="font-medium">{unresolved ? "No account selected" : "No accounts yet"}</div>
        <p className="mt-0.5 text-muted-foreground">
          {unresolved ? (
            <>
              The selected account no longer exists — it may have been renamed or removed. Choose an
              account from the switcher above. No figures are shown until one is selected.
            </>
          ) : (
            <>
              Import positions or add an account to see your portfolio.{" "}
              <Link to="/settings" className="underline underline-offset-2">
                Go to Settings
              </Link>
              .
            </>
          )}
        </p>
      </div>
    </div>
  );
}

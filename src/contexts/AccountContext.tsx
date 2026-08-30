// AccountContext — the single source of truth for "which account am I looking at?"
// (PR-UI-2). Before this, every screen re-derived the account by matching a
// hardcoded name string, and fell back to accountless manual rows on a miss —
// which rendered a plausible but wrong portfolio with no error. Selection now
// lives here, and an unresolvable selection is an explicit state, never a
// silent substitution.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useAccounts, type Account } from "@/hooks/useAppData";
import {
  defaultAccountId,
  selectAccountHoldings,
} from "@/lib/accountSelection";

// Re-exported so screens import selection helpers from one place.
export { defaultAccountId, selectAccountHoldings };

const STORAGE_KEY = "invespal.selectedAccountId";

/**
 * `loading`    — accounts have not arrived yet; render skeletons, not zeros.
 * `no-accounts`— the user has no accounts at all; prompt an import.
 * `unresolved` — a selection exists but no longer matches an account (renamed
 *                or deleted). This is the case that used to fail silently.
 * `ready`      — `selectedAccount` is a real row.
 */
export type AccountStatus = "loading" | "no-accounts" | "unresolved" | "ready";

export type AccountContextValue = {
  accounts: Account[];
  selectedAccount: Account | null;
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string) => void;
  status: AccountStatus;
  isLoading: boolean;
};

const AccountContext = createContext<AccountContextValue | null>(null);

function readStored(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    // Private mode / storage disabled — selection just won't persist.
    return null;
  }
}

function writeStored(id: string): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, id);
  } catch {
    /* non-fatal */
  }
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const { data: accounts = [], isLoading } = useAccounts();
  // Three distinct states, deliberately:
  //   undefined — storage not read yet
  //   null      — read, nothing stored
  //   string    — read, a selection exists
  //
  // Collapsing the first two into `null` meant the first render fell straight
  // through to the default account, so a user whose stored selection was a
  // different account saw that account's figures flash before the effect ran.
  // On a screen used for real money decisions, briefly-wrong numbers are the
  // exact failure this PR exists to remove.
  //
  // Storage is read on mount rather than in the initializer so the first client
  // render matches whatever the server produced (no localStorage there).
  const [storedId, setStoredId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setStoredId(readStored());
  }, []);

  const setSelectedAccountId = useCallback((id: string) => {
    setStoredId(id);
    writeStored(id);
  }, []);

  const value = useMemo<AccountContextValue>(() => {
    const storageRead = storedId !== undefined;
    const resolved = storedId ? (accounts.find((a) => a.id === storedId) ?? null) : null;

    // No explicit choice → fall back to the default account. This is a default,
    // not a substitution: it applies only once storage has been read and held
    // nothing. Before that we resolve to nothing and report `loading`.
    const fallbackId = storedId === null ? defaultAccountId(accounts) : null;
    const fallback = fallbackId ? (accounts.find((a) => a.id === fallbackId) ?? null) : null;
    const selectedAccount = resolved ?? fallback;

    let status: AccountStatus;
    if (isLoading || !storageRead) status = "loading";
    else if (accounts.length === 0) status = "no-accounts";
    else if (selectedAccount === null) status = "unresolved";
    else status = "ready";

    return {
      accounts,
      selectedAccount,
      selectedAccountId: selectedAccount?.id ?? null,
      setSelectedAccountId,
      status,
      isLoading,
    };
  }, [accounts, storedId, isLoading, setSelectedAccountId]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccountContext(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) {
    throw new Error("useAccountContext must be used inside <AccountProvider>");
  }
  return ctx;
}


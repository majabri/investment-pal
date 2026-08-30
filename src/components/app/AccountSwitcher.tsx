// Shell-level account switcher (PR-UI-2). Minimal by design — PR-UI-4 restyles
// the shell. Its job here is to make the selected account visible and
// changeable, so an unresolved selection is recoverable without a code change.
import { useAccountContext } from "@/contexts/AccountContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function AccountSwitcher({ className }: { className?: string }) {
  const { accounts, selectedAccountId, setSelectedAccountId, status } = useAccountContext();

  if (status === "loading" || status === "no-accounts") return null;

  return (
    <Select value={selectedAccountId ?? ""} onValueChange={setSelectedAccountId}>
      <SelectTrigger className={className} aria-label="Selected account">
        <SelectValue placeholder="Select an account" />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

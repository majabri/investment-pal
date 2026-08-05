import { createFileRoute } from "@tanstack/react-router";
import { KidsCategoryDashboard } from "@/components/app/KidsCategoryDashboard";

export const Route = createFileRoute("/_authenticated/kids-crypto")({ component: Page });

function Page() {
  return (
    <KidsCategoryDashboard
      title="Kids Crypto Dashboard"
      subtitle="Fidelity Crypto® accounts · live prices (BTC/ETH/SOL) every 60s"
      matchAccount={(name) => {
        const m = /^(Karim|Zain|Jude)\s*Crypto/i.exec(name.trim());
        return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
      }}
      emptyHint="No kids crypto accounts yet — they're created automatically by a Fidelity import with 'Create accounts for everything in the file' switched on."
    />
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { KidsCategoryDashboard } from "@/components/app/KidsCategoryDashboard";

export const Route = createFileRoute("/_authenticated/kids-529")({ component: Page });

function Page() {
  return (
    <KidsCategoryDashboard
      title="Kids 529 Dashboard"
      subtitle="College savings accounts · live where quotable · 529 units priced from latest import"
      matchAccount={(name) => {
        const m = /^(Karim|Zain|Jude)\s*529$/i.exec(name.trim());
        return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
      }}
      emptyHint="No 529 accounts yet — they're created automatically by a Fidelity import with 'Create accounts for everything in the file' switched on."
    />
  );
}

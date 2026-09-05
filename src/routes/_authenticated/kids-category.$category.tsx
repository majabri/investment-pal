// One route for the kids' category dashboards.
//
// `kids-529.tsx` and `kids-crypto.tsx` were the same 18-line file rendering
// `KidsCategoryDashboard` with a different account regex, title and hint. They
// are now rows in a config table, which is what they always were.
import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/app/AppShell";
import { KidsCategoryDashboard } from "@/components/app/KidsCategoryDashboard";

export const Route = createFileRoute("/_authenticated/kids-category/$category")({
  component: Page,
});

type CategoryConfig = {
  title: string;
  subtitle: string;
  matchAccount: (name: string) => string | null;
  emptyHint: string;
};

/** Match a kid's name against a suffix pattern, normalising its capitalisation. */
function matchKid(pattern: RegExp) {
  return (name: string): string | null => {
    const m = pattern.exec(name.trim());
    return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
  };
}

// Null-prototype: a crafted param like /kids-category/constructor would
// otherwise return an inherited property, make `config` truthy, and then throw
// on `config.title`. Unknown values must reach the explicit unknown state.
const CATEGORIES: Record<string, CategoryConfig> = Object.assign(Object.create(null), {
  "529": {
    title: "Kids 529 Dashboard",
    subtitle:
      "College savings accounts · live where quotable · 529 units priced from latest import",
    matchAccount: matchKid(/^(Karim|Zain|Jude)\s*529$/i),
    emptyHint:
      "No 529 accounts yet — they're created automatically by a Fidelity import with 'Create accounts for everything in the file' switched on.",
  },
  crypto: {
    title: "Kids Crypto Dashboard",
    subtitle: "Fidelity Crypto® accounts · live prices (BTC/ETH/SOL) every 60s",
    matchAccount: matchKid(/^(Karim|Zain|Jude)\s*Crypto/i),
    emptyHint:
      "No kids crypto accounts yet — they're created automatically by a Fidelity import with 'Create accounts for everything in the file' switched on.",
  },
});

/**
 * Known category names, for the unknown-category message.
 *
 * Derived, not retyped: a hand-written copy drifts the moment a category is
 * added or removed, and the drift shows up as an error message that lies about
 * what is available. Safe on a null-prototype object.
 */
export const KIDS_CATEGORIES = Object.keys(CATEGORIES);

/** Own-property lookup only. Belt and braces alongside the null prototype. */
export function categoryConfig(category: string): CategoryConfig | null {
  return Object.hasOwn(CATEGORIES, category) ? CATEGORIES[category] : null;
}

function Page() {
  const { category } = Route.useParams();
  const config = categoryConfig(category);

  // An unknown category is a broken link, not a crash and not an empty
  // portfolio — the difference matters when the screen shows money.
  if (!config) {
    return (
      <AppShell title="Unknown category" subtitle="This family category does not exist">
        <div className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
          No family category named “{category}”. Known categories: {KIDS_CATEGORIES.join(", ")}.
        </div>
      </AppShell>
    );
  }

  return (
    <KidsCategoryDashboard
      title={config.title}
      subtitle={config.subtitle}
      matchAccount={config.matchAccount}
      emptyHint={config.emptyHint}
    />
  );
}

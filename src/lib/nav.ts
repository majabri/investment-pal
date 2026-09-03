// Navigation model.
//
// Stage 3 collapsed 18 flat entries into 7 sections. This is subtraction of
// navigation, not of features: every page that existed still exists and is
// still reachable — it is now a tab inside the section it belongs to, rather
// than a peer of every other page in a list nobody could scan.
//
// The property this file exists to keep testable: every route in the app is
// reachable at 390px. The bug it replaced was `flatMap(...).slice(0, 5)` in
// AppShell, which left 13 of 18 routes unreachable on a phone — and Amir
// approves from a phone, so an unreachable route blocked approvals.
import {
  LayoutDashboard,
  Briefcase,
  Sparkles,
  Settings as SettingsIcon,
  Users,
  Telescope,
  Gavel,
} from "lucide-react";

export type NavTab = { to: string; label: string };
export type NavSection = {
  /** Where the section itself lands. Always the first tab when tabs exist. */
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Pages inside the section. Empty when the section is a single page. */
  tabs: NavTab[];
};

export const navSections: NavSection[] = [
  {
    to: "/",
    label: "Investment Office",
    icon: LayoutDashboard,
    tabs: [],
  },
  {
    to: "/portfolio",
    label: "Portfolio",
    icon: Briefcase,
    tabs: [
      { to: "/portfolio", label: "Holdings" },
      { to: "/ira", label: "IRA" },
    ],
  },
  {
    to: "/decisions",
    label: "Decisions",
    icon: Gavel,
    tabs: [
      { to: "/decisions", label: "Committee decisions" },
      { to: "/journal", label: "Journal" },
    ],
  },
  {
    to: "/watchlist",
    label: "Research",
    icon: Telescope,
    tabs: [
      { to: "/watchlist", label: "Watchlist" },
      { to: "/opportunities", label: "Opportunities" },
      { to: "/news", label: "News" },
      { to: "/earnings", label: "Earnings" },
      { to: "/economic-calendar", label: "Economic calendar" },
      { to: "/geopolitics", label: "Geopolitics" },
    ],
  },
  {
    to: "/prompt-center",
    label: "Committee",
    icon: Sparkles,
    // The committee scorecard is rendered inside the Prompt Center rather than
    // being its own route, so the section is a single page with no tab strip.
    tabs: [],
  },
  {
    to: "/kids",
    label: "Family",
    icon: Users,
    tabs: [
      { to: "/kids", label: "Trading" },
      { to: "/kids-category/529", label: "529" },
      { to: "/kids-category/crypto", label: "Crypto" },
      { to: "/kids-watchlist", label: "Watchlist" },
      { to: "/kids-prompt-center", label: "Prompts" },
    ],
  },
  {
    to: "/settings",
    label: "Settings",
    icon: SettingsIcon,
    tabs: [
      { to: "/settings", label: "Settings" },
      { to: "/goals", label: "Goals" },
    ],
  },
];

/**
 * The sections worth a permanent thumb-reach slot. Everything else is one tap
 * away via More, which renders every section and every tab.
 */
export const MOBILE_PRIMARY: Array<{ to: string; label: string; shortLabel: string; icon: typeof LayoutDashboard }> = [
  { to: "/", label: "Investment Office", shortLabel: "Office", icon: LayoutDashboard },
  { to: "/portfolio", label: "Portfolio", shortLabel: "Portfolio", icon: Briefcase },
  { to: "/decisions", label: "Decisions", shortLabel: "Decisions", icon: Gavel },
  { to: "/prompt-center", label: "Committee", shortLabel: "Committee", icon: Sparkles },
];

/** Every route the navigation can reach, sections and tabs alike. */
export function allNavRoutes(): string[] {
  const out: string[] = [];
  for (const s of navSections) {
    if (!out.includes(s.to)) out.push(s.to);
    for (const t of s.tabs) if (!out.includes(t.to)) out.push(t.to);
  }
  return out;
}

/**
 * The section that owns a pathname, so the shell can highlight it and show the
 * right tab strip. Longest match wins: `/kids-watchlist` must resolve to Family
 * on its own tab entry, not to Research because `/watchlist` is a substring.
 */
export function sectionForPath(pathname: string): NavSection | null {
  let best: NavSection | null = null;
  let bestLen = -1;
  for (const s of navSections) {
    for (const route of [s.to, ...s.tabs.map((t) => t.to)]) {
      const exact = pathname === route;
      const child = route !== "/" && pathname.startsWith(`${route}/`);
      if ((exact || child) && route.length > bestLen) {
        best = s;
        bestLen = route.length;
      }
    }
  }
  return best;
}

// Navigation model (PR-UI-2). Extracted from AppShell so mobile reachability is
// a testable property rather than a visual one.
//
// The bug this guards: the mobile bar was `navGroups.flatMap(...).slice(0, 5)`,
// so 13 of 18 routes were unreachable on a phone — all of Kids, all research,
// and Settings — and reordering the array silently changed which. Amir approves
// from an iPhone, so unreachable routes block approvals.
import {
  LayoutDashboard,
  Briefcase,
  Sparkles,
  BookOpen,
  Target,
  Settings as SettingsIcon,
  Eye,
  Users,
  Newspaper,
  TrendingUp,
  CalendarClock,
  CalendarDays,
  Globe,
  PiggyBank,
} from "lucide-react";

export type NavItem = { to: string; label: string; icon: typeof LayoutDashboard };
export type NavGroup = { group: string; items: NavItem[] };

export const navGroups: NavGroup[] = [
  {
    group: "Portfolio",
    items: [
      { to: "/", label: "Investment Office", icon: LayoutDashboard },
      { to: "/prompt-center", label: "Prompt Center", icon: Sparkles },
      { to: "/portfolio", label: "Portfolio", icon: Briefcase },
      { to: "/journal", label: "Trade Journal", icon: BookOpen },
      { to: "/watchlist", label: "Investment Watchlist", icon: Eye },
      { to: "/goals", label: "Goals", icon: Target },
      { to: "/ira", label: "IRA", icon: PiggyBank },
    ],
  },
  {
    group: "Kids",
    items: [
      { to: "/kids", label: "Kids Trading Dashboard", icon: Users },
      { to: "/kids-529", label: "Kids 529 Dashboard", icon: Users },
      { to: "/kids-crypto", label: "Kids Crypto Dashboard", icon: Users },
      { to: "/kids-prompt-center", label: "Kids Prompt Center", icon: Sparkles },
      { to: "/kids-watchlist", label: "Kids Watchlist", icon: Eye },
    ],
  },
  {
    group: "General",
    items: [
      { to: "/news", label: "News", icon: Newspaper },
      { to: "/opportunities", label: "Opportunities", icon: TrendingUp },
      { to: "/earnings", label: "Earnings", icon: CalendarClock },
      { to: "/economic-calendar", label: "Economic Calendar", icon: CalendarDays },
      { to: "/geopolitics", label: "Geopolitics", icon: Globe },
      { to: "/settings", label: "Settings", icon: SettingsIcon },
    ],
  },
];

/** The three sections worth a permanent thumb-reach slot. Everything else is
 *  one tap away in the More sheet, which renders `navGroups` in full. */
export const MOBILE_PRIMARY: Array<NavItem & { shortLabel: string }> = [
  { to: "/", label: "Investment Office", shortLabel: "Office", icon: LayoutDashboard },
  { to: "/portfolio", label: "Portfolio", shortLabel: "Portfolio", icon: Briefcase },
  { to: "/prompt-center", label: "Prompt Center", shortLabel: "Prompts", icon: Sparkles },
];

export function allNavRoutes(): string[] {
  return navGroups.flatMap((g) => g.items.map((i) => i.to));
}

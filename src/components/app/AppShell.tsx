import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  Briefcase,
  Sparkles,
  BookOpen,
  Target,
  Settings as SettingsIcon,
  LogOut,
  Eye,
  Users,
  Newspaper,
  TrendingUp,
  CalendarClock,
  CalendarDays,
  Globe,
} from "lucide-react";
import { MarketTape } from "./MarketTape";

import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard };
type NavGroup = { group: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    group: "Amir",
    items: [
      { to: "/", label: "Amir Dashboard", icon: LayoutDashboard },
      { to: "/prompt-center", label: "Prompt Center", icon: Sparkles },
      { to: "/portfolio", label: "Portfolio", icon: Briefcase },
      { to: "/journal", label: "Trade Journal", icon: BookOpen },
      { to: "/watchlist", label: "Investment Watchlist", icon: Eye },
      { to: "/goals", label: "Goals", icon: Target },
    ],
  },
  {
    group: "Kids",
    items: [
      { to: "/kids", label: "Kids Dashboard", icon: Users },
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

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-16 items-center gap-2 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <LayoutDashboard className="h-4 w-4" />
          </div>
          <div className="text-sm font-semibold tracking-tight">Investment Companion</div>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
          {navGroups.map((g) => (
            <div key={g.group}>
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                {g.group}
              </div>
              <div className="space-y-0.5">
                {g.items.map((item) => {
                  const active =
                    item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t p-3">
          <button
            onClick={() => supabase.auth.signOut()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="flex items-center justify-between border-b px-4 py-3 md:hidden">
          <div className="text-sm font-semibold">Investment Companion</div>
          <Button size="sm" variant="ghost" onClick={() => supabase.auth.signOut()}>
            Sign out
          </Button>
        </div>

        <MarketTape />
        <header className="flex flex-col gap-2 border-b bg-background/80 px-6 py-5 backdrop-blur sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
            {subtitle ? (
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </header>

        <main className="flex-1 px-6 py-6">{children}</main>

        {/* Mobile bottom nav */}
        <nav className="sticky bottom-0 flex justify-around border-t bg-sidebar/95 px-2 py-1 backdrop-blur md:hidden">
          {navGroups.flatMap((g) => g.items).slice(0, 5).map((item) => {
            const active =
              item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-3 py-2 text-[10px]",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

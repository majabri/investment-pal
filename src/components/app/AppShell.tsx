import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { LayoutDashboard, LogOut, Menu } from "lucide-react";
import { MarketTape } from "./MarketTape";
import { navGroups, MOBILE_PRIMARY } from "@/lib/nav";
import { APP_VERSION } from "@/lib/version";

import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { AccountSwitcher } from "./AccountSwitcher";

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
        <div className="px-3 pb-2">
          <AccountSwitcher className="h-8 w-full text-xs" />
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
        <div className="flex items-center gap-2 border-b px-4 py-3 md:hidden">
          <AccountSwitcher className="h-8 min-w-0 flex-1 text-xs" />
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

        {/* Mobile bottom nav — three primaries plus a More sheet.
            This used to be `.slice(0, 5)` over the flattened list, which left
            13 of 18 routes unreachable on a phone (all of Kids, all research,
            Settings) and silently changed what phones could reach whenever the
            array was reordered. Every route is now reachable at 390px. */}
        <nav className="sticky bottom-0 flex justify-around border-t bg-sidebar/95 px-2 py-1 backdrop-blur md:hidden">
          {MOBILE_PRIMARY.map((item) => {
            const active =
              item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex min-w-0 flex-col items-center gap-0.5 px-3 py-2 text-[11px]",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                <span className="truncate">{item.shortLabel}</span>
              </Link>
            );
          })}
          <Sheet>
            <SheetTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 flex-col items-center gap-0.5 px-3 py-2 text-[11px] text-muted-foreground"
              >
                <Menu className="h-4 w-4" />
                <span>More</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>All sections</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4 pb-6">
                {navGroups.map((g) => (
                  <div key={g.group}>
                    <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {g.group}
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {g.items.map((item) => {
                        const active =
                          item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                        return (
                          <Link
                            key={item.to}
                            to={item.to}
                            className={cn(
                              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                              active
                                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                : "text-muted-foreground",
                            )}
                          >
                            <item.icon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </nav>
      </div>
    </div>
  );
}

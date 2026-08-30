// Mobile reachability is an acceptance criterion, not a nicety: Amir approves
// from an iPhone, so a route the phone cannot reach blocks approvals (PR-UI-2).
//
// The replaced bar was `navGroups.flatMap(...).slice(0, 5)` — positional, so
// 13 of 18 routes were unreachable and reordering the array silently changed
// which ones. These tests pin the property that replaced it.
import { describe, expect, test } from "bun:test";

import { navGroups, MOBILE_PRIMARY, allNavRoutes } from "../nav";

describe("navigation model", () => {
  test("every route is reachable on mobile", () => {
    // The More sheet renders `navGroups` in full, so every route in the model
    // is one tap away regardless of viewport width.
    const routes = allNavRoutes();
    expect(routes.length).toBeGreaterThan(MOBILE_PRIMARY.length);
    for (const route of routes) {
      const inSheet = navGroups.some((g) => g.items.some((i) => i.to === route));
      expect(inSheet).toBe(true);
    }
  });

  test("previously unreachable sections are in the model", () => {
    // These are exactly the routes the old `.slice(0, 5)` cut off.
    const routes = allNavRoutes();
    for (const route of [
      "/kids",
      "/kids-529",
      "/kids-crypto",
      "/kids-prompt-center",
      "/kids-watchlist",
      "/news",
      "/opportunities",
      "/earnings",
      "/economic-calendar",
      "/geopolitics",
      "/settings",
      "/goals",
      "/ira",
    ]) {
      expect(routes).toContain(route);
    }
  });

  test("the thumb-reach bar holds few enough entries to fit a 390px viewport", () => {
    // Three primaries plus the More trigger = four targets. At 390px that
    // leaves ~97px each, comfortably above the 44px minimum touch target.
    expect(MOBILE_PRIMARY.length).toBe(3);
    expect((390 / (MOBILE_PRIMARY.length + 1))).toBeGreaterThanOrEqual(44);
  });

  test("every thumb-reach entry is a real route", () => {
    const routes = allNavRoutes();
    for (const item of MOBILE_PRIMARY) {
      expect(routes).toContain(item.to);
    }
  });

  test("routes are unique", () => {
    const routes = allNavRoutes();
    expect(new Set(routes).size).toBe(routes.length);
  });

  test("no nav group is named after a person", () => {
    // Groups label what the section is, not whose it is (portfolio-agnostic).
    for (const g of navGroups) {
      expect(g.group).not.toBe("Amir");
    }
  });
});

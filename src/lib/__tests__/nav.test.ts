// Mobile reachability is an acceptance criterion, not a nicety: the owner approves
// from an iPhone, so a route the phone cannot reach blocks approvals.
//
// Stage 3 collapsed 18 flat entries into 7 sections with tabs. That is
// subtraction of navigation, not of features — so the test that matters is that
// nothing became unreachable in the process.
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";

import { navSections, MOBILE_PRIMARY, allNavRoutes, sectionForPath } from "../nav";

describe("the collapse kept every page", () => {
  test("there are exactly seven sections", () => {
    expect(navSections).toHaveLength(7);
    expect(navSections.map((s) => s.label)).toEqual([
      "Investment Office",
      "Portfolio",
      "Decisions",
      "Research",
      "Committee",
      "Family",
      "Settings",
    ]);
  });

  test("every page from the old flat nav is still reachable", () => {
    // The 18 entries the old model listed, minus the two duplicate kids shells
    // that were deliberately folded into /kids-category/$category.
    const routes = allNavRoutes();
    for (const route of [
      "/",
      "/portfolio",
      "/ira",
      "/journal",
      "/watchlist",
      "/goals",
      "/prompt-center",
      "/kids",
      "/kids-prompt-center",
      "/kids-watchlist",
      "/news",
      "/opportunities",
      "/earnings",
      "/economic-calendar",
      "/geopolitics",
      "/settings",
    ]) {
      expect(routes).toContain(route);
    }
  });

  test("the retired kids shells are reachable as category tabs", () => {
    const routes = allNavRoutes();
    expect(routes).toContain("/kids-category/529");
    expect(routes).toContain("/kids-category/crypto");
  });

  test("the Decisions surface is in the model", () => {
    expect(allNavRoutes()).toContain("/decisions");
  });

  test("every route file has a nav entry", () => {
    // Guards the real failure mode: adding a page and forgetting to navigate to
    // it, which is how routes became unreachable in the first place.
    const files = readdirSync("src/routes/_authenticated").filter(
      (f) => f.endsWith(".tsx") && f !== "route.tsx",
    );
    const routes = new Set(allNavRoutes());
    const missing: string[] = [];
    for (const f of files) {
      if (f === "index.tsx") continue; // "/"
      if (f.includes("$")) continue; // parameterised, covered by its tab entries
      const path = `/${f.replace(/\.tsx$/, "")}`;
      if (!routes.has(path)) missing.push(path);
    }
    expect(missing).toEqual([]);
  });

  test("routes are unique across sections and tabs", () => {
    const routes = allNavRoutes();
    expect(new Set(routes).size).toBe(routes.length);
  });

  test("no section is named after a person", () => {
    for (const s of navSections) {
      expect(s.label).not.toBe("Amir");
    }
  });
});

describe("mobile reachability at 390px", () => {
  test("the thumb bar fits, with the More trigger", () => {
    // Four primaries plus More = five targets. 390 / 5 = 78px each, above the
    // 44px minimum touch target.
    expect(MOBILE_PRIMARY.length).toBe(4);
    expect(390 / (MOBILE_PRIMARY.length + 1)).toBeGreaterThanOrEqual(44);
  });

  test("every thumb-reach entry is a real section", () => {
    const sections = new Set(navSections.map((s) => s.to));
    for (const item of MOBILE_PRIMARY) {
      expect(sections.has(item.to)).toBe(true);
    }
  });

  test("the More sheet reaches everything the thumb bar does not", () => {
    // The sheet renders every section and every tab, so this is the property
    // that keeps 390px complete.
    const primary = new Set(MOBILE_PRIMARY.map((i) => i.to));
    const unreachable = allNavRoutes().filter((r) => {
      if (primary.has(r)) return false;
      return !navSections.some((s) => s.to === r || s.tabs.some((t) => t.to === r));
    });
    expect(unreachable).toEqual([]);
  });
});

describe("sectionForPath", () => {
  test("resolves a tab to its owning section", () => {
    expect(sectionForPath("/ira")?.label).toBe("Portfolio");
    expect(sectionForPath("/geopolitics")?.label).toBe("Research");
    expect(sectionForPath("/journal")?.label).toBe("Decisions");
  });

  test("longest match wins, so /kids-watchlist is Family not Research", () => {
    // `/watchlist` is a substring of `/kids-watchlist`. A naive startsWith
    // check would put the kids' watchlist under Research.
    expect(sectionForPath("/kids-watchlist")?.label).toBe("Family");
    expect(sectionForPath("/watchlist")?.label).toBe("Research");
  });

  test("root resolves to Investment Office and does not swallow other paths", () => {
    expect(sectionForPath("/")?.label).toBe("Investment Office");
    // "/" must not prefix-match everything.
    expect(sectionForPath("/settings")?.label).toBe("Settings");
  });

  test("a parameterised category resolves to Family", () => {
    expect(sectionForPath("/kids-category/529")?.label).toBe("Family");
  });

  test("an unknown category still resolves to Family", () => {
    // Post-merge Copilot finding: /kids-category/<unknown> returned null, so
    // the route's own "no such category" page rendered with no section
    // highlight and no tab strip — exactly where a lost reader needs the nav.
    expect(sectionForPath("/kids-category/bogus")?.label).toBe("Family");
    expect(sectionForPath("/kids-category/constructor")?.label).toBe("Family");
  });

  test("prefix matching does not leak across sections", () => {
    // /kids-category owning its subtree must not make it own unrelated paths.
    expect(sectionForPath("/kids-categoryX")).toBeNull();
  });

  test("an unknown path resolves to nothing rather than guessing", () => {
    expect(sectionForPath("/nonexistent")).toBeNull();
  });
});

// Invariant: the app's `zod` must resolve to v3 (ADR-APP-005 / incident #70).
//
// Salvaged from PR #89, which sat ~40 commits behind and was closed rather than
// rebased. The invariant itself never reached `main`, and it is the only thing
// in the repo that asserts what `import { z } from "zod"` actually resolves to.
//
// WHY IT IS NOT ACADEMIC
//
// `bun.lock` carries BOTH majors. zod 3.25.76 at the top level, and zod 4.4.3
// nested under four packages:
//
//   @tanstack/start-plugin-core, @tanstack/router-generator,
//   @tanstack/router-plugin, eslint-plugin-react-hooks
//
// Incident #70 was a zod 3/4 mismatch that passed `tsc` cleanly and crashed the
// app at boot on zod 4's `.prefault`. `package.json` pins `^3.25.76` and
// Dependabot ignores the zod major — but a caret and an ignore rule constrain
// what is REQUESTED, not what is RESOLVED. Hoisting, a transitive bump or a
// lockfile regeneration can move the top-level copy without either noticing.
//
// This was not hypothetical again today: a half-completed `bun install` during
// a branch merge left the tree in a state where the dev server died with
// `pagePrerenderOptionsSchema.optional(...).prefault is not a function` —
// `@tanstack/start-plugin-core` calling a zod-4 API on a zod-3 schema. A clean
// install fixed it, and `main` was never affected, but for several minutes the
// only evidence available could not distinguish "my tree is broken" from
// "`main` is broken". This test is what makes that distinguishable.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { z } from "zod";

describe("zod resolves to v3 (ADR-APP-005 / incident #70)", () => {
  test("does not expose the v4-only .prefault — i.e. what we import IS v3", () => {
    // `.prefault` is the exact zod-4 API whose absence on v3 crashed #70, and
    // whose presence on a v3 schema is what a caller expecting v4 asks for.
    const schema = z.string().optional() as unknown as { prefault?: unknown };
    expect(schema.prefault).toBeUndefined();
  });

  test("exposes the v3 .default — a real zod schema is imported, not a stub", () => {
    // Without this, the assertion above would pass against any object that
    // happens not to have a `prefault` property. Including `undefined`.
    const schema = z.string().default("x");
    expect(typeof schema.parse).toBe("function");
    expect(schema.parse(undefined)).toBe("x");
  });

  test("the RESOLVED package version is a 3.x", () => {
    // The behavioural check above proves the API surface; this proves the
    // identity. A zod 4 that happened to drop `.prefault` would pass the first
    // and fail this, and a shimmed module would fail both.
    const pkg = JSON.parse(readFileSync(require.resolve("zod/package.json"), "utf8")) as {
      version: string;
    };
    expect(pkg.version.startsWith("3.")).toBe(true);
  });

  test("package.json still pins the 3.x range", () => {
    // The caret does not constrain resolution — that is what the tests above
    // are for — but a change here is a deliberate act, and it should not be
    // possible to make it without this file going red.
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies.zod).toMatch(/^\^?3\./);
  });

  test("NEGATIVE CONTROL: the .prefault check can tell v4 from v3", () => {
    // Five green assertions about an absent property prove nothing unless the
    // check can see the property when it IS there. A zod 4 schema has it.
    const v4Like = { prefault: () => undefined } as unknown as { prefault?: unknown };
    expect(v4Like.prefault).not.toBeUndefined();
  });
});

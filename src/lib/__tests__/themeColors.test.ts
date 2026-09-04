// A chart with axes and no visible line reads as "no data", not as "broken
// style" — which is why this survived unnoticed on `main`.
//
// The cause: this theme defines its colour tokens as COMPLETE colours
// (`--primary: oklch(0.78 0.14 195)`), not as the bare HSL channel triplets
// that shadcn's default theme uses. So `hsl(var(--primary))` expands to
// `hsl(oklch(0.78 0.14 195))`, which is not a valid colour. The browser drops
// it silently: no stroke, and gradient stops that resolve to nothing.
//
// Nothing in the type system or the test suite can catch an invalid CSS colour
// string, so this guards the spelling instead.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function productionSources(dir = "src"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "test") continue;
      out.push(...productionSources(full));
    } else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("theme colour tokens are used as whole colours", () => {
  test("no production source wraps a theme token in a colour function", () => {
    // `var(--token)`, never `hsl(var(--token))` — nor rgb/hsla/rgba/oklch, all
    // of which fail the same way for the same reason. The doughnut always used
    // the bare form and always rendered; the balance chart used the wrapped
    // form and drew nothing.
    const offenders: string[] = [];
    for (const file of productionSources()) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const fn of ["hsl", "rgb", "hsla", "rgba", "oklch"]) {
        const re = new RegExp(`${fn}\\(\\s*var\\(--`, "g");
        if (re.test(code)) offenders.push(`${file.replace(/\\/g, "/")} wraps a token in ${fn}()`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the theme really does define whole colours, not channel triplets", () => {
    // The premise the rule above rests on. If the theme is ever migrated to
    // bare channels, this fails and tells us the rule no longer applies —
    // rather than the rule quietly becoming wrong.
    const css = readFileSync("src/styles.css", "utf8");
    const primary = /--primary:\s*([^;]+);/.exec(css)?.[1]?.trim();
    expect(primary).toBeDefined();
    // A bare channel triplet looks like `195 78% 14%` — it starts with a digit
    // and only becomes a colour once a function wraps it. A whole colour starts
    // with its own syntax: a colour-space function, or a hex literal.
    expect(primary).toMatch(/^(oklch|hsl|rgb|#)/);
  });
});

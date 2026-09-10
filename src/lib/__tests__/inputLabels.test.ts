// Every text input has an accessible name (audit brief G4, folding in #135).
//
// The app shipped 59 `<Input>` elements and 6 of them had a name. A screen
// reader announced the rest as "edit text", and clicking a visible label did
// not focus its field — including on the Settings forms that write balances.
//
// This scan is the guard. `Field` is proven to associate its label at RUNTIME
// in `components/app/__tests__/field.test.tsx`; here a `Field`-wrapped input is
// accepted without a static id, because that is exactly what `Field` supplies.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function tsxFiles(dir = "src"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      // The shadcn primitives in ui/ are wrappers with no labels of their own.
      if (entry === "ui" || entry === "__tests__") continue;
      out.push(...tsxFiles(path));
    } else if (entry.endsWith(".tsx")) {
      out.push(path);
    }
  }
  return out;
}

/**
 * The attribute text of every `<Input ...>` tag, with its offset.
 *
 * Brace- and quote-aware, because a naive `<Input[^>]*>` stops at the `>` in
 * `onChange={(e) => …}` and silently reports a labelled input as unlabelled.
 * The first version of this scan did exactly that: it produced false positives
 * on four files and a duplicate `aria-label` that only tsc caught.
 */
export function inputTags(src: string): { at: number; attrs: string }[] {
  const out: { at: number; attrs: string }[] = [];
  const re = /<Input\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let i = re.lastIndex;
    let depth = 0;
    let quote: string | null = null;
    while (i < src.length) {
      const c = src[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") {
        quote = c;
      } else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
      i++;
    }
    out.push({ at: m.index, attrs: src.slice(re.lastIndex, i) });
  }
  return out;
}

const NAMED = /\bid=|\baria-label=|\baria-labelledby=/;

/** Whether this tag sits directly inside a `<Field label="…">`. */
function insideField(src: string, at: number): boolean {
  const before = src.slice(0, at);
  const open = before.lastIndexOf("<Field ");
  if (open === -1) return false;
  // A closing tag between them means the Field ended before this input.
  return !before.slice(open).includes("</Field>");
}

describe("every Input has an accessible name", () => {
  test("no unlabelled inputs anywhere in the app", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles()) {
      const src = readFileSync(file, "utf8");
      for (const { at, attrs } of inputTags(src)) {
        if (NAMED.test(attrs)) continue;
        if (insideField(src, at)) continue;
        offenders.push(`${file}:${src.slice(0, at).split("\n").length}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("NEGATIVE CONTROL: the scan sees an unlabelled input", () => {
    const src = `<Input value={q} onChange={(e) => setQ(e.target.value)} />`;
    const tags = inputTags(src);
    expect(tags).toHaveLength(1);
    // The arrow function's `>` must not terminate the tag — the whole reason
    // this is a parser rather than a regex.
    expect(tags[0].attrs).toContain("onChange");
    expect(NAMED.test(tags[0].attrs)).toBe(false);
  });

  test("NEGATIVE CONTROL: it sees a labelled one past an arrow function", () => {
    const src = `<Input onChange={(e) => setQ(e.target.value)} aria-label="Filter" />`;
    expect(NAMED.test(inputTags(src)[0].attrs)).toBe(true);
  });

  test("NEGATIVE CONTROL: a Field-wrapped input counts, an escaped one does not", () => {
    const wrapped = `<Field label="Name">\n  <Input value={x} />\n</Field>`;
    expect(insideField(wrapped, wrapped.indexOf("<Input"))).toBe(true);
    const after = `<Field label="Name">\n  <Input id="a" />\n</Field>\n<Input value={y} />`;
    expect(insideField(after, after.lastIndexOf("<Input"))).toBe(false);
  });
});

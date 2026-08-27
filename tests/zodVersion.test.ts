// Invariant: the app's zod must resolve to v3, NOT the zod 4 that lives
// transitively in bun.lock (under @tanstack/start-plugin-core and
// eslint-plugin-react-hooks). Incident #70: a zod 3/4 mismatch passed `tsc`
// and crashed at boot on zod 4's `.prefault`. The Dependabot ignore stops the
// direct bump but asserts nothing about resolution — this asserts what actually
// gets imported. If this fails, `import { z } from "zod"` is resolving to v4.
import { describe, it, expect } from "vitest";
import { z } from "zod";

describe("zod resolves to v3 (ADR-APP-005 / incident #70)", () => {
  it("does not expose the v4-only .prefault method — i.e. this is v3", () => {
    // `.prefault` is the exact zod-4 API whose absence on v3 crashed #70.
    const schema = z.string().optional() as unknown as { prefault?: unknown };
    expect(schema.prefault).toBeUndefined();
  });

  it("exposes the v3 .default method (sanity: a real zod schema is imported)", () => {
    const schema = z.string().default("x");
    expect(typeof schema.parse).toBe("function");
    expect(schema.parse(undefined)).toBe("x");
  });
});

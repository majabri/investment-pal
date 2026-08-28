// Reusable accessibility assertion (PR-UI-0). Runs axe-core against a rendered
// container and fails with the rule id, impact and offending markup for each
// violation — a bare "expected 0, got 3" is not actionable in review.
//
// Scoped to WCAG 2.1 A/AA, which is the bar the Phase 10 accessibility exit gate
// is written against. Colour-contrast is disabled: happy-dom does not compute
// styles from the Tailwind layer, so the rule reports incomplete, not passing.
import axe, { type ElementContext, type RunOptions } from "axe-core";

const DEFAULT_OPTIONS: RunOptions = {
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  rules: { "color-contrast": { enabled: false } },
};

export async function assertNoA11yViolations(
  container: ElementContext,
  options: RunOptions = {},
): Promise<void> {
  const results = await axe.run(container, { ...DEFAULT_OPTIONS, ...options });

  if (results.violations.length === 0) return;

  const detail = results.violations
    .map((v) => {
      const nodes = v.nodes.map((n) => `      ${n.html}`).join("\n");
      return `  [${v.id}] (${v.impact ?? "unknown"}) ${v.help}\n${nodes}`;
    })
    .join("\n");

  throw new Error(`axe found ${results.violations.length} violation(s):\n${detail}`);
}

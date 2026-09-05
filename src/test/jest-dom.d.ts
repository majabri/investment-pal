// Teaches `bun:test` about the jest-dom matchers that src/test/setup.ts registers
// via expect.extend (PR-UI-0). @testing-library/jest-dom ships augmentations for
// jest and vitest only, so bun's Matchers interface needs this one explicitly —
// without it `toBeInTheDocument` runs fine but fails `bun run test:typecheck`.
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "bun:test" {
  // Both interfaces are deliberately empty: module augmentation merges them into
  // bun's own declarations, and an empty body extending the jest-dom matchers is
  // how that merge is expressed. `no-empty-object-type` is right in general and
  // wrong here — a type alias cannot participate in declaration merging, so there
  // is no non-empty form of this that still works.
  /* eslint-disable @typescript-eslint/no-empty-object-type */
  interface Matchers<T = unknown> extends TestingLibraryMatchers<unknown, T> {}
  interface AsymmetricMatchers extends TestingLibraryMatchers<unknown, unknown> {}
  /* eslint-enable @typescript-eslint/no-empty-object-type */
}

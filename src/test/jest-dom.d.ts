// Teaches `bun:test` about the jest-dom matchers that src/test/setup.ts registers
// via expect.extend (PR-UI-0). @testing-library/jest-dom ships augmentations for
// jest and vitest only, so bun's Matchers interface needs this one explicitly —
// without it `toBeInTheDocument` runs fine but fails `bun run test:typecheck`.
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "bun:test" {
  interface Matchers<T = unknown> extends TestingLibraryMatchers<unknown, T> {}
  interface AsymmetricMatchers extends TestingLibraryMatchers<unknown, unknown> {}
}

// Test preload (PR-UI-0). Loaded for every `bun test` run via bunfig.toml's
// [test] preload, so component tests get a DOM before any module imports React.
//
// Order matters: happy-dom must be registered before @testing-library/* is
// imported anywhere, otherwise those modules capture an undefined `document`.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof globalThis.document === "undefined") {
  GlobalRegistrator.register();
}

const { expect, afterEach } = await import("bun:test");
const matchers = await import("@testing-library/jest-dom/matchers");
const { cleanup } = await import("@testing-library/react");

expect.extend(matchers.default ?? matchers);

// Unmount anything a test rendered so the next test starts on a clean document.
afterEach(() => {
  cleanup();
});

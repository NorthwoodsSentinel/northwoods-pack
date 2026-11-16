// Test and coverage configuration. The coverage bar is the source's (the
// modelcontextprotocol/inspector rules file): >= 90 on all four dimensions, per
// file. The owner's ruling: the source's way stands until there is a reason to depart.
//
// This file lives in gate/ so its tooling installs from gate/package.json and never
// from the root package.json the Deploy button installs. `root` points back at the
// repository so tests/ and src/ resolve as usual. Tests use Vitest globals
// (describe/test/expect/vi), so test files import nothing from gate/node_modules.
//
// The Worker runs here under Node, not workerd. D1 is backed by node:sqlite in
// tests/support/d1.ts, so every query in src/ runs against a real SQLite engine.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root,
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      // Every source file is gated, including ones no test imports yet: a new file
      // under src/ lands in the gate automatically.
      include: ["src/**/*.ts"],
      // Exact paths only, one per entry, never a glob, so an exclusion can never
      // hide a new file. Each entry names its follow-up.
      exclude: [],
      thresholds: {
        perFile: true,
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 90,
      },
    },
  },
});

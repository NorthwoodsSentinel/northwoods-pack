// ESLint flat config. Lint runs with --max-warnings 0 (see AGENTS.md, "Lint has no
// warning tier"), so every rule enforced here is effectively an error. It lives in
// gate/ with the rest of the dev tooling; `npm run lint` runs it from the repo root.
// Generated output is never linted (AGENTS.md, "Build output is never a gate target").
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/",
      ".wrangler/",
      "dist/",
      "build/",
      "coverage/",
      ".scratch/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.mts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    // Node-run tooling (scripts/*.mjs, gate/*.mjs): no type information, Node globals.
    files: ["**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: { process: "readonly", console: "readonly", URL: "readonly" },
    },
  },
);

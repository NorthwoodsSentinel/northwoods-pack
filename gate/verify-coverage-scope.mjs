// verify-coverage-scope: the coverage gate must show how much it checked.
//
// A coverage run that silently measures fewer files than it should still passes its
// thresholds (the modelcontextprotocol/inspector rules file records a run that dropped
// from 418 files to 11 and stayed green). This script runs after
// `vitest run --coverage` and fails, listing each one, if any src/**/*.ts file is
// missing from coverage/coverage-summary.json without being on the exact-path
// exclusion list in gate/vitest.config.mts. It prints the count it checked so a
// shrinking scope is visible in the log. It walks src/ itself (no subprocess), so it
// behaves the same in any sandbox.
//
// Fix a failure by fixing the include/exclude in gate/vitest.config.mts, never by
// excusing the file here.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = (
  await import(new URL("./vitest.config.mts", import.meta.url).href)
).default;
const excluded = new Set(config.test.coverage.exclude);
for (const e of excluded) {
  if (/[*?{}[\]]/.test(e)) {
    console.error(
      `verify-coverage-scope: exclusion "${e}" is a glob; exclusions must be exact paths`,
    );
    process.exit(1);
  }
}

function walk(dir) {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(
    (d) => {
      const rel = path.posix.join(dir, d.name);
      if (d.isDirectory()) return walk(rel);
      return d.name.endsWith(".ts") && !d.name.endsWith(".d.ts") ? [rel] : [];
    },
  );
}

const sources = walk("src");
const summary = JSON.parse(
  readFileSync(path.join(root, "coverage", "coverage-summary.json"), "utf8"),
);
const measured = new Set(
  Object.keys(summary)
    .filter((k) => k !== "total")
    .map((k) => path.relative(root, k).split(path.sep).join("/")),
);

const missing = sources.filter((f) => !excluded.has(f) && !measured.has(f));
const staleExclusions = [...excluded].filter((e) => !sources.includes(e));
if (sources.length === 0 || missing.length || staleExclusions.length) {
  if (sources.length === 0)
    console.error("verify-coverage-scope: found no source files under src/");
  for (const f of missing)
    console.error(
      `verify-coverage-scope: ${f} is a source file but was not measured`,
    );
  for (const e of staleExclusions)
    console.error(`verify-coverage-scope: exclusion ${e} names no source file`);
  process.exit(1);
}
console.log(
  `verify-coverage-scope: ${measured.size} file(s) measured, ${excluded.size} excluded by exact path, ${sources.length} source file(s): OK`,
);

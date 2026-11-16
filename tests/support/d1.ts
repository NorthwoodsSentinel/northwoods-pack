// A D1Database backed by node:sqlite, so the tests run every query in src/ against a
// real SQLite engine (FTS5 included) rather than a hand-written fake.
//
// Matches the parts of the D1 contract src/ relies on: prepare(sql).bind(...values)
// returns a statement with all(), first() and run(); batch(statements) runs them in
// one transaction and rolls back on any error; a SQL error rejects the promise.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Env } from "../../src/common";

type Row = Record<string, SQLInputValue>;

export interface FakeD1 {
  db: DatabaseSync;
  // When set, any statement whose SQL contains this text throws (failure-path tests).
  failOn?: string;
  prepare(sql: string): FakeStatement;
  batch(
    statements: FakeStatement[],
  ): Promise<{ success: true; results: Row[] }[]>;
}

export interface FakeStatement {
  sql: string;
  values: SQLInputValue[];
  bind(...values: unknown[]): FakeStatement;
  all<T = Row>(): Promise<{ success: true; results: T[]; meta: object }>;
  first<T = Row>(): Promise<T | null>;
  run(): Promise<{ success: true; results: Row[]; meta: object }>;
}

export function createD1(): FakeD1 {
  const db = new DatabaseSync(":memory:");
  const d1: FakeD1 = {
    db,
    prepare(sql: string) {
      return statement(sql, []);
    },
    async batch(statements: FakeStatement[]) {
      db.exec("BEGIN");
      try {
        const out = statements.map((s) => ({
          success: true as const,
          results: rows(s),
        }));
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };

  function rows(s: FakeStatement): Row[] {
    if (d1.failOn && s.sql.includes(d1.failOn))
      throw new Error(`forced failure on ${d1.failOn}`);
    const prepared = db.prepare(s.sql);
    if (prepared.columns().length === 0) {
      prepared.run(...s.values);
      return [];
    }
    return prepared.all(...s.values) as Row[];
  }

  function statement(sql: string, values: SQLInputValue[]): FakeStatement {
    const s: FakeStatement = {
      sql,
      values,
      bind: (...next: unknown[]) => statement(sql, next as SQLInputValue[]),
      all: async <T>() => ({
        success: true as const,
        results: rows(s) as T[],
        meta: {},
      }),
      first: async <T>() => (rows(s)[0] as T | undefined) ?? null,
      run: async () => ({ success: true as const, results: rows(s), meta: {} }),
    };
    return s;
  }

  return d1;
}

export interface TestEnv {
  env: Env;
  d1: FakeD1;
  ai: { run: ReturnType<typeof vi.fn> };
}

export const REAL_TOKEN =
  "9f2c1e7a4b8d0c3f6e5a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6a";

// A full Env: real-SQLite D1, an unused KV stand-in, and a Workers AI stub whose
// reply each test sets. Extra vars (MEMORY_WRITES) are merged in.
export function makeTestEnv(
  token: string | undefined = REAL_TOKEN,
  extra: Record<string, string> = {},
): TestEnv {
  const d1 = createD1();
  const ai = { run: vi.fn(async () => ({ response: "" }) as unknown) };
  // Double cast: the stand-ins implement only the parts of the D1/KV/AI interfaces
  // that src/ calls, which the full Cloudflare types cannot express.
  const env = {
    DEMO_TOKEN: token,
    DB: d1,
    PREFS: {},
    AI: ai,
    ...extra,
  } as unknown as Env;
  return { env, d1, ai };
}

// A TestEnv whose database already has the full schema, built by a fresh copy of
// src/setup.ts (its ensureSchema() memo is per module instance).
export async function makeSchemaEnv(
  token: string | undefined = REAL_TOKEN,
  extra: Record<string, string> = {},
): Promise<TestEnv> {
  const t = makeTestEnv(token, extra);
  vi.resetModules();
  const { ensureSchema } = await import("../../src/setup");
  await ensureSchema(t.env);
  return t;
}

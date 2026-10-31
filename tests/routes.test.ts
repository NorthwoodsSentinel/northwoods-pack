// Route-level checks: every token-gated route, driven through the real
// Worker fetch handler, so a route that stops using tokenMatches() (or skips
// the default-token lockout) fails here, not just the helper's unit tests.
import { describe, expect, test } from "bun:test";
import worker from "../src/index";
import { DEFAULT_TOKEN } from "../src/setup";
import type { Env } from "../src/common";

const REAL = "9f2c1e7a4b8d0c3f6e5a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6a";

// Minimal D1/KV stand-ins: empty results, no writes kept.
function makeEnv(token: string | undefined): Env {
  const stmt: any = {
    bind: () => stmt,
    all: async () => ({ results: [] }),
    first: async () => null,
    run: async () => ({ success: true, meta: {} }),
  };
  return {
    DEMO_TOKEN: token,
    DB: { prepare: () => stmt, batch: async () => [], exec: async () => ({}) },
    PREFS: { get: async () => null, put: async () => {}, list: async () => ({ keys: [] }) },
    AI: { run: async () => ({ response: "" }) },
  } as unknown as Env;
}

const BASE = "https://pack.example";
const post = (path: string, body: unknown) =>
  new Request(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// Each gated route, built for a presented token.
const ROUTES: Record<string, (t: string) => Request> = {
  "GET /export?token=": (t) => new Request(`${BASE}/export?token=${encodeURIComponent(t)}`),
  "GET /export (header)": (t) => new Request(`${BASE}/export`, { headers: { "X-Pack-Token": t } }),
  "catch-all (header)": (t) => new Request(`${BASE}/no-such-route`, { headers: { "X-Pack-Token": t } }),
  "POST /chat/send": (t) => post("/chat/send", { token: t, messages: [] }),
  "POST /intake": (t) => post("/intake", { token: t }),
  "GET /mcp/:token": (t) => new Request(`${BASE}/mcp/${encodeURIComponent(t)}`),
};

const call = (req: Request, env: Env) => worker.fetch(req, env);

describe("every token-gated route", () => {
  for (const [name, build] of Object.entries(ROUTES)) {
    test(`${name}: 503 while the token is unset`, async () => {
      expect((await call(build("anything"), makeEnv(undefined))).status).toBe(503);
    });
    test(`${name}: 503 while the token is the factory default, even when presented`, async () => {
      expect((await call(build(DEFAULT_TOKEN), makeEnv(DEFAULT_TOKEN))).status).toBe(503);
    });
    test(`${name}: 401 for a wrong token`, async () => {
      expect((await call(build("wrong-" + REAL), makeEnv(REAL))).status).toBe(401);
    });
    test(`${name}: gets past the gate with the right token`, async () => {
      const status = (await call(build(REAL), makeEnv(REAL))).status;
      expect(status).not.toBe(401);
      expect(status).not.toBe(503);
    });
  }
});

describe("MCP token in the URL path", () => {
  const tricky = "a b?c#d%e/f&g=h";
  test("a token with URL metacharacters works when percent-encoded", async () => {
    const res = await call(new Request(`${BASE}/mcp/${encodeURIComponent(tricky)}`), makeEnv(tricky));
    expect(res.status).toBe(200);
  });
  test("malformed percent-encoding is rejected, not thrown", async () => {
    const res = await call(new Request(`${BASE}/mcp/%E0%A4%A`), makeEnv(REAL));
    expect(res.status).toBe(401);
  });
});

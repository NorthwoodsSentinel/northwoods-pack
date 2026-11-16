// Helpers for driving the real Worker fetch handler in tests.
//
// src/setup.ts memoizes ensureSchema() per isolate, as it should in production. Each
// test gets a fresh in-memory database, so each test also needs a fresh copy of the
// modules: freshWorker() resets the module registry and imports src/index anew, the
// way a cold Worker isolate would start.
import type { Env } from "../../src/common";

export const BASE = "https://pack.example";

type Worker = { fetch(request: Request, env: Env): Promise<Response> };

export async function freshWorker(): Promise<Worker> {
  vi.resetModules();
  return (await import("../../src/index")).default;
}

export function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function get(
  path: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(BASE + path, { headers });
}

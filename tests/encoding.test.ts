// The MCP URL is built in three places: the server (intake response) and the
// inline scripts of the /connect and /intake pages. These tests RUN each
// served page's real inline script against a small stub DOM, type a token
// through the page's own input handler, and check the URL the page renders.
// Any regression (trimming, a weaker encoder, skipping the encoder) shows up
// in the rendered output, whatever the source text looks like.
import { describe, expect, test } from "bun:test";
import worker from "../src/index";
import { encodeTokenSegment } from "../src/common";
import type { Env } from "../src/common";

const REAL = "9f2c1e7a4b8d0c3f6e5a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6a";
const TRICKY = [" spaced token ", "\ttabbed\n", "a(b)", "it's", "bang!now*", "a b?c#d%e/f&g=h", "$(id)`x`;|&<>", "ünïcødé"];
const SHELL_SAFE = /^[A-Za-z0-9\-_.~%]+$/;
const ORIGIN = "https://pack.example";

function makeEnv(token: string): Env {
  const stmt: any = { bind: () => stmt, all: async () => ({ results: [] }), first: async () => null, run: async () => ({}) };
  return {
    DEMO_TOKEN: token,
    DB: { prepare: () => stmt, batch: async () => [], exec: async () => ({}) },
    PREFS: { get: async () => null, put: async () => {}, list: async () => ({ keys: [] }) },
    AI: { run: async () => ({ response: "" }) },
  } as unknown as Env;
}

type El = { value: string; textContent: string; handlers: Record<string, (e: unknown) => void>; addEventListener(t: string, f: (e: unknown) => void): void };

// Load a page, run its inline <script> with a stub DOM, return its elements.
async function loadPage(path: string): Promise<Record<string, El>> {
  const html = await (await worker.fetch(new Request(ORIGIN + path), makeEnv(REAL))).text();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (scripts.length === 0) throw new Error(`no inline script in ${path}`);
  const els: Record<string, El> = {};
  const el = (id: string): El =>
    (els[id] ??= { value: "", textContent: "", handlers: {}, addEventListener(t, f) { this.handlers[t] = f; } });
  const document = { getElementById: el, querySelector: () => el("_q"), querySelectorAll: () => [] };
  for (const s of scripts) new Function("document", "location", "fetch", s)(document, { origin: ORIGIN }, async () => new Response("{}"));
  return els;
}

// Type a token into the page's input and return everything the page rendered.
function type(els: Record<string, El>, inputId: string, token: string): string[] {
  const input = els[inputId];
  input.value = token;
  input.handlers.input?.({ target: input });
  return Object.values(els).map((e) => e.textContent).filter((t) => t.includes("/mcp/"));
}

const PAGES = [
  { path: "/connect", input: "tok" },
  { path: "/intake", input: "token" },
];

describe("MCP URL rendered by the pages", () => {
  for (const { path, input } of PAGES) {
    test(`${path}: renders the exact server-encoded, shell-safe URL for every token`, async () => {
      const els = await loadPage(path);
      for (const t of TRICKY) {
        const rendered = type(els, input, t);
        expect(rendered.length).toBeGreaterThan(0);
        const want = `${ORIGIN}/mcp/${encodeTokenSegment(t)}`;
        for (const text of rendered) {
          expect(text).toContain(want);
          const seg = text.slice(text.indexOf("/mcp/") + 5).split(/\s/)[0];
          expect(seg).toMatch(SHELL_SAFE);
        }
      }
    });
  }

  test("POST /intake returns an mcp_url with the server-encoded, shell-safe token", async () => {
    for (const t of TRICKY) {
      const res = await worker.fetch(
        new Request(`${ORIGIN}/intake`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: t, seed_memories: "one seed" }),
        }),
        makeEnv(t),
      );
      expect(res.status).toBe(200);
      const { mcp_url } = (await res.json()) as { mcp_url: string };
      expect(mcp_url).toBe(`${ORIGIN}/mcp/${encodeTokenSegment(t)}`);
      expect(mcp_url.slice(`${ORIGIN}/mcp/`.length)).toMatch(SHELL_SAFE);
    }
  });

  test("every encoded tricky token authenticates through /mcp/", async () => {
    for (const t of TRICKY) {
      const res = await worker.fetch(new Request(`${ORIGIN}/mcp/${encodeTokenSegment(t)}`), makeEnv(t));
      expect(res.status).toBe(200);
    }
  });

  test("server encoder output is shell-safe and round-trips", () => {
    for (const t of TRICKY) {
      expect(encodeTokenSegment(t)).toMatch(SHELL_SAFE);
      expect(decodeURIComponent(encodeTokenSegment(t))).toBe(t);
    }
  });
});

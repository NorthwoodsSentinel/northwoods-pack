/**
 * Shared types + helpers across all 5 modules.
 */

export interface Env {
  DEMO_TOKEN: string;
  DB: D1Database;
  PREFS: KVNamespace;
  AI: Ai;
}

export function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, X-Pack-Token, X-Mycelia-Opt-In",
  };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

export function unauthorized(): Response {
  return json({ error: "Unauthorized" }, 401);
}

export function notFound(path: string): Response {
  return json({ error: "Not found", path }, 404);
}

export function invalidJson(): Response {
  return json({ error: "Invalid JSON" }, 400);
}

/**
 * Encode the token as one MCP URL path segment (RFC 3986 strict): the result
 * is only A-Z a-z 0-9 - _ . ~ and %XX, so it survives as a URL path segment
 * and as an unquoted shell argument. The browser pages carry the same rule
 * inline (encodeTokenSegment in connect.ts / intake.ts); keep them identical.
 */
export function encodeTokenSegment(token: string): string {
  return encodeURIComponent(token).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

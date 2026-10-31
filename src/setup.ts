/**
 * setup, the two failure modes a fresh deploy-button install can hit, made
 * impossible to hit silently. Born from a live doubt ("honestly I doubt you
 * smoke tested this") that was correct: the worker was smoke-tested, the
 * stranger's install path was not.
 *
 * 1. ensureSchema(): a fresh D1 has no tables if the deploy flow didn't run
 *    migrations. Rather than 500 at minute six of the ten-minute path, the
 *    consolidated schema (all migrations, final shape) is applied lazily,
 *    every statement idempotent, so it costs one cheap no-op batch on a DB
 *    that's already set up.
 *
 * 2. tokenIsDefault(): shipping a plaintext placeholder token means every
 *    installer who misses it shares one publicly-known key. The worker
 *    refuses to operate on the default, fail closed, with the exact fix
 *    printed where the person is standing.
 */
import { Env } from "./common";

export const DEFAULT_TOKEN = "CHANGE-ME-RUN-openssl-rand-hex-32";

export function tokenIsDefault(env: Env): boolean {
  return !env.DEMO_TOKEN || env.DEMO_TOKEN === DEFAULT_TOKEN;
}

// kintsugi: the door was checked five ways by five hands, and two forgot the factory key;
//   now one hand holds it, never opens to the default, and takes the same time for every wrong key.
/**
 * The one token check. Fails closed while the token is unset or still the
 * factory default, and compares SHA-256 digests in constant time so response
 * timing says nothing about how much of a guess was right.
 */
export async function tokenMatches(env: Env, presented: string | null | undefined): Promise<boolean> {
  if (tokenIsDefault(env) || typeof presented !== "string" || presented.length === 0) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(presented)),
    crypto.subtle.digest("SHA-256", enc.encode(env.DEMO_TOKEN)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export const TOKEN_HELP =
  "This pot is still locked with the factory token, so it refuses to work, otherwise every install would share one public key. " +
  "Set your own: in your Cloudflare dashboard open this Worker → Settings → Variables and Secrets, replace DEMO_TOKEN with a long random string " +
  "(or run: npx wrangler secret put DEMO_TOKEN). Then come back here.";

// The final shape of every table, as CREATE IF NOT EXISTS, a fresh database
// arrives complete; an existing one is untouched.
const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS substrate_entries (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, body TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'api',
    trust_level TEXT NOT NULL DEFAULT 'mixed',
    sensitivity TEXT NOT NULL DEFAULT 'personal')`,
  `CREATE INDEX IF NOT EXISTS idx_entries_type ON substrate_entries(type)`,
  `CREATE INDEX IF NOT EXISTS idx_entries_created ON substrate_entries(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS identity_fields (
    key TEXT PRIMARY KEY, value TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'interview', updated_at INTEGER NOT NULL)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(body, entry_id UNINDEXED, type UNINDEXED)`,
  `CREATE TABLE IF NOT EXISTS loops (
    id TEXT PRIMARY KEY, body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL, closed_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_loops_status ON loops(status, created_at DESC)`,
];

let schemaEnsured = false; // per-isolate memo; harmless to re-run after cold start

export async function ensureSchema(env: Env): Promise<void> {
  if (schemaEnsured) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  schemaEnsured = true;
}

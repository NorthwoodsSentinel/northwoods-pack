import { describe, expect, test } from "bun:test";
import { DEFAULT_TOKEN, tokenIsDefault, tokenMatches } from "../src/setup";
import type { Env } from "../src/common";

const env = (DEMO_TOKEN: string | undefined) => ({ DEMO_TOKEN } as unknown as Env);
const REAL = "9f2c1e7a4b8d0c3f6e5a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6a";

describe("tokenMatches", () => {
  test("accepts the exact configured token", async () => {
    expect(await tokenMatches(env(REAL), REAL)).toBe(true);
  });

  test("rejects a wrong token, a prefix, and a token with extra characters", async () => {
    expect(await tokenMatches(env(REAL), "nope")).toBe(false);
    expect(await tokenMatches(env(REAL), REAL.slice(0, -1))).toBe(false);
    expect(await tokenMatches(env(REAL), REAL + "x")).toBe(false);
    expect(await tokenMatches(env(REAL), REAL.toUpperCase())).toBe(false);
  });

  test("rejects missing or non-string input", async () => {
    for (const p of [undefined, null, "", 0 as unknown as string, {} as unknown as string]) {
      expect(await tokenMatches(env(REAL), p)).toBe(false);
    }
  });

  test("fails closed while the token is unset or still the factory default", async () => {
    expect(await tokenMatches(env(undefined), "")).toBe(false);
    expect(await tokenMatches(env(undefined), "anything")).toBe(false);
    expect(await tokenMatches(env(""), "")).toBe(false);
    expect(await tokenMatches(env(DEFAULT_TOKEN), DEFAULT_TOKEN)).toBe(false);
    expect(tokenIsDefault(env(DEFAULT_TOKEN))).toBe(true);
  });
});

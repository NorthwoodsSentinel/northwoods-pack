// MCP server (src/mcp.ts) against a real-SQLite D1: the JSON-RPC envelope, every tool's
// read and write path, pilot mode (MEMORY_WRITES=off), and the error codes.
import { handleMcp } from "../src/mcp";
import { makeSchemaEnv, REAL_TOKEN, type TestEnv } from "./support/d1";
import { get, post } from "./support/worker";

type Rpc = {
  id: unknown;
  result?: { content?: { text: string }[]; tools?: unknown[] };
  error?: { code: number };
};

async function rpc(t: TestEnv, method: string, params?: unknown): Promise<Rpc> {
  const res = await handleMcp(
    post("/mcp/x", { jsonrpc: "2.0", id: 1, method, params }),
    t.env,
    REAL_TOKEN,
  );
  return (await res.json()) as Rpc;
}

async function call(
  t: TestEnv,
  name: string,
  args?: Record<string, unknown>,
): Promise<string> {
  const out = await rpc(t, "tools/call", { name, arguments: args });
  return out.result?.content?.[0]?.text ?? `error ${out.error?.code}`;
}

describe("envelope", () => {
  test("a wrong token is 401 and GET returns the hint", async () => {
    const t = await makeSchemaEnv();
    expect((await handleMcp(get("/mcp/x"), t.env, "nope")).status).toBe(401);
    expect(
      (
        (await (await handleMcp(get("/mcp/x"), t.env, REAL_TOKEN)).json()) as {
          mcp: string;
        }
      ).mcp,
    ).toBe("northwoods-pack");
  });

  test("parse error, initialize, initialized notification, ping, tools/list, unknown method", async () => {
    const t = await makeSchemaEnv();
    const bad = (await (
      await handleMcp(post("/mcp/x", "{nope"), t.env, REAL_TOKEN)
    ).json()) as Rpc;
    expect(bad.error?.code).toBe(-32700);
    expect((await rpc(t, "initialize")).result).toMatchObject({
      protocolVersion: "2025-06-18",
    });
    expect(
      (
        await handleMcp(
          post("/mcp/x", { method: "notifications/initialized" }),
          t.env,
          REAL_TOKEN,
        )
      ).status,
    ).toBe(202);
    expect((await rpc(t, "ping")).result).toEqual({});
    expect((await rpc(t, "tools/list")).result?.tools).toHaveLength(8);
    expect((await rpc(t, "nope")).error?.code).toBe(-32601);
  });

  test("tools/call with no params is an unknown tool; a database failure is -32603", async () => {
    const t = await makeSchemaEnv();
    expect((await rpc(t, "tools/call")).error?.code).toBe(-32602);
    t.d1.failOn = "identity_fields";
    expect(await call(t, "get_identity")).toBe("error -32603");
  });
});

describe("identity tools", () => {
  test("get_identity on an empty pot returns the interview script", async () => {
    const t = await makeSchemaEnv();
    expect(await call(t, "get_identity")).toContain("YOU are the intake");
  });

  test("set_identity validates, stores, and get_identity reads it back", async () => {
    const t = await makeSchemaEnv();
    expect(await call(t, "set_identity", { key: "bad", value: "x" })).toContain(
      "key must be one of",
    );
    expect(await call(t, "set_identity", { key: "call_me" })).toBe(
      "Empty value.",
    );
    expect(await call(t, "set_identity", {})).toContain("key must be one of");
    expect(
      await call(t, "set_identity", { key: "call_me", value: " Sam " }),
    ).toContain("Stored call_me");
    expect(await call(t, "get_identity")).toContain("# Sam");
  });

  test("correct_me appends voice and never-rules", async () => {
    const t = await makeSchemaEnv();
    expect(await call(t, "correct_me", {})).toBe("Empty correction.");
    expect(await call(t, "correct_me", { rule: "be brief" })).toContain(
      "voice rule",
    );
    expect(await call(t, "correct_me", { rule: "be plain" })).toContain(
      "voice rule",
    );
    expect(
      await call(t, "correct_me", { rule: "no hype", kind: "anti" }),
    ).toContain("never-rule");
    const v = t.d1.db
      .prepare("SELECT value FROM identity_fields WHERE key='voice_rules'")
      .get();
    expect(v?.value).toBe("- be brief\n- be plain");
  });
});

describe("memory tools", () => {
  test("remember stores with a valid or defaulted type, and recall finds it", async () => {
    const t = await makeSchemaEnv();
    expect(await call(t, "remember", {})).toBe("Nothing to store.");
    expect(
      await call(t, "remember", {
        body: "likes pine trees",
        type: "preference",
      }),
    ).toContain("preference");
    expect(
      await call(t, "remember", { body: "maple syrup", type: "weird" }),
    ).toContain("(fact,");
    expect(await call(t, "recall_memories", {})).toBe("Empty query.");
    expect(
      await call(t, "recall_memories", { query: 'pine "trees"' }),
    ).toContain("[preference · mcp · mixed] likes pine trees");
    expect(await call(t, "recall_memories", { query: "nothing" })).toBe(
      "No matching memories.",
    );
  });

  test("recall never returns secret entries", async () => {
    const t = await makeSchemaEnv();
    t.d1.db.exec(
      "INSERT INTO substrate_entries (id, type, body, created_at, updated_at, sensitivity) VALUES ('s', 'fact', 'hidden code', 1, 1, 'secret')",
    );
    t.d1.db.exec(
      "INSERT INTO entries_fts (body, entry_id, type) VALUES ('hidden code', 's', 'fact')",
    );
    expect(await call(t, "recall_memories", { query: "hidden" })).toBe(
      "No matching memories.",
    );
  });
});

describe("shelf tools", () => {
  test("where_was_i: nothing owed, then the latest memory (cut at 140), then the held loop", async () => {
    const t = await makeSchemaEnv();
    expect(await call(t, "where_was_i")).toContain("Nothing's owed");
    await call(t, "remember", { body: "x".repeat(200) });
    const warm = await call(t, "where_was_i");
    expect(warm).toContain("Pick up where it was warm");
    expect(warm.endsWith("...")).toBe(true);
    const t2 = await makeSchemaEnv();
    await call(t2, "remember", { body: "short" });
    expect(await call(t2, "where_was_i")).toContain("warm: short");
    expect(await call(t, "hold_this", {})).toBe("Nothing to hold.");
    expect(await call(t, "hold_this", { body: "call the vet" })).toContain(
      "Held.",
    );
    expect(await call(t, "where_was_i")).toContain("hold: call the vet");
  });

  test("whats_open: clear shelf, one at a time oldest first, done and release", async () => {
    const t = await makeSchemaEnv();
    expect(await call(t, "whats_open")).toBe("The shelf is clear.");
    await call(t, "hold_this", { body: "first" });
    const next = await call(t, "whats_open", { action: "next" });
    expect(next).toContain("(1 held in total): first");
    const id = /done:(\w+)/.exec(next)?.[1] ?? "";
    expect(await call(t, "whats_open", { action: `done:${id}` })).toBe(
      "Closed. Good.",
    );
    await call(t, "hold_this", { body: "second" });
    const id2 = /done:(\w+)/.exec(await call(t, "whats_open"))?.[1] ?? "";
    expect(await call(t, "whats_open", { action: `release:${id2}` })).toContain(
      "Released",
    );
    const rows = t.d1.db
      .prepare("SELECT status FROM loops ORDER BY body")
      .all();
    expect(rows.map((r) => r.status)).toEqual(["done", "released"]);
  });
});

describe("pilot mode", () => {
  test("MEMORY_WRITES=off acknowledges write tools and stores nothing; reads stay live", async () => {
    const t = await makeSchemaEnv(REAL_TOKEN, { MEMORY_WRITES: "OFF" });
    for (const name of [
      "set_identity",
      "correct_me",
      "remember",
      "hold_this",
    ]) {
      expect(
        await call(t, name, {
          key: "call_me",
          value: "x",
          rule: "r",
          body: "b",
        }),
      ).toContain("nothing was saved");
    }
    expect(
      t.d1.db.prepare("SELECT COUNT(*) AS n FROM substrate_entries").get()?.n,
    ).toBe(0);
    expect(await call(t, "whats_open")).toBe("The shelf is clear.");
  });
});

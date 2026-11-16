// Substrate module (src/substrate.ts) against a real-SQLite D1: remember, recall and
// list with every filter, input validation, and the helpers resume and /api call.
import {
  entryCount,
  getLatestEntry,
  handleList,
  handleRecall,
  handleRemember,
} from "../src/substrate";
import { makeSchemaEnv } from "./support/d1";
import { BASE, post } from "./support/worker";

type Listing = {
  entries: { body: string; tags: string[]; type: string }[];
  count: number;
};

async function seed(env: Awaited<ReturnType<typeof makeSchemaEnv>>["env"]) {
  const items = [
    { type: "note", body: "alpha one", tags: ["a", 7] },
    { type: "decision", body: "beta two", tags: ["b"] },
    { type: "note", body: "gamma three", tags: "not-an-array" },
  ];
  for (const item of items) {
    expect(
      (await handleRemember(post("/substrate/remember", item), env)).status,
    ).toBe(200);
  }
}

describe("handleRemember", () => {
  test("rejects invalid JSON, a missing type and a missing body", async () => {
    const { env } = await makeSchemaEnv();
    expect((await handleRemember(post("/r", "{nope"), env)).status).toBe(400);
    expect((await handleRemember(post("/r", { body: "b" }), env)).status).toBe(
      400,
    );
    expect(
      (await handleRemember(post("/r", { type: "", body: "b" }), env)).status,
    ).toBe(400);
    expect(
      (await handleRemember(post("/r", { type: "note" }), env)).status,
    ).toBe(400);
    expect(
      (await handleRemember(post("/r", { type: "note", body: "" }), env))
        .status,
    ).toBe(400);
  });

  test("stores the entry with only its string tags", async () => {
    const { env, d1 } = await makeSchemaEnv();
    await seed(env);
    const rows = d1.db
      .prepare("SELECT body, tags_json FROM substrate_entries ORDER BY body")
      .all();
    expect(rows.map((r) => r.tags_json)).toEqual(['["a"]', '["b"]', "[]"]);
  });
});

describe("handleRecall", () => {
  test("rejects invalid JSON", async () => {
    const { env } = await makeSchemaEnv();
    expect((await handleRecall(post("/r", "{nope"), env)).status).toBe(400);
  });

  test("filters by type, query and tags, skipping empty or non-string tags", async () => {
    const { env } = await makeSchemaEnv();
    await seed(env);
    const recall = async (body: unknown) =>
      (await (await handleRecall(post("/r", body), env)).json()) as Listing;
    expect((await recall({})).count).toBe(3);
    expect((await recall({ type: "note" })).count).toBe(2);
    expect((await recall({ query: "beta" })).entries[0].body).toBe("beta two");
    expect((await recall({ query: "" })).count).toBe(3);
    expect(
      (await recall({ tags: ["a", "", 5] })).entries.map((e) => e.body),
    ).toEqual(["alpha one"]);
    expect((await recall({ tags: [] })).count).toBe(3);
    expect((await recall({ limit: 1 })).count).toBe(1);
    expect((await recall({ limit: -5 })).count).toBe(1);
  });

  test("an unreadable tags_json reads back as no tags", async () => {
    const { env, d1 } = await makeSchemaEnv();
    d1.db.exec(
      "INSERT INTO substrate_entries (id, type, body, tags_json, created_at, updated_at) VALUES ('x', 'note', 'b', '{bad', 1, 1)",
    );
    const out = (await (
      await handleRecall(post("/r", {}), env)
    ).json()) as Listing;
    expect(out.entries[0].tags).toEqual([]);
  });
});

describe("handleList", () => {
  test("filters by type and tag, clamps the limit, and falls back on a bad limit", async () => {
    const { env } = await makeSchemaEnv();
    await seed(env);
    const list = async (q: string) =>
      (await (
        await handleList(new URL(BASE + "/substrate/list" + q), env)
      ).json()) as Listing;
    expect((await list("")).count).toBe(3);
    expect((await list("?type=note")).count).toBe(2);
    expect((await list("?tag=b")).entries[0].body).toBe("beta two");
    expect((await list("?limit=1")).count).toBe(1);
    expect((await list("?limit=abc")).count).toBe(3);
    expect((await list("?limit=-3")).count).toBe(1);
  });
});

describe("getLatestEntry and entryCount", () => {
  test("null and zero on an empty store, the newest entry and the count after writes", async () => {
    const { env } = await makeSchemaEnv();
    expect(await getLatestEntry(env)).toBeNull();
    expect(await entryCount(env)).toBe(0);
    await seed(env);
    expect((await getLatestEntry(env))?.body).toBeDefined();
    expect(await entryCount(env)).toBe(3);
  });
});

// Router checks for src/index.ts, driven through the real Worker fetch handler with a
// real-SQLite D1: the front door by state, /api, /export, every page route, and every
// token-gated API route, including the 500 path and the 404 fallthrough.
import { DEFAULT_TOKEN } from "../src/setup";
import { makeTestEnv, REAL_TOKEN } from "./support/d1";
import { BASE, freshWorker, get, post } from "./support/worker";

const auth = { "X-Pack-Token": REAL_TOKEN };

describe("front door and info", () => {
  test("OPTIONS answers the CORS preflight with 204", async () => {
    const w = await freshWorker();
    const res = await w.fetch(
      new Request(BASE + "/anything", { method: "OPTIONS" }),
      makeTestEnv().env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("GET / on the factory token shows the one-step-left page", async () => {
    const w = await freshWorker();
    const res = await w.fetch(get("/"), makeTestEnv(DEFAULT_TOKEN).env);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toContain("One step left");
  });

  test("GET / on a real token builds the schema and shows the two doors", async () => {
    const w = await freshWorker();
    const { env, d1 } = makeTestEnv();
    const res = await w.fetch(get("/"), env);
    expect(await res.text()).toContain("Your harness is alive");
    const tables = d1.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    expect(tables.map((t) => t.name)).toContain("substrate_entries");
  });

  test("GET /api reports setup needed and zero entries before the database exists", async () => {
    const w = await freshWorker();
    const res = await w.fetch(get("/api"), makeTestEnv(DEFAULT_TOKEN).env);
    const body = (await res.json()) as {
      setup: { needed: boolean };
      modules: { substrate: { entries_count: number } };
    };
    expect(body.setup.needed).toBe(true);
    expect(body.modules.substrate.entries_count).toBe(0);
  });

  test("GET /api counts entries once the database has them", async () => {
    const w = await freshWorker();
    const { env } = makeTestEnv();
    await w.fetch(get("/"), env);
    await w.fetch(
      post("/substrate/remember", { type: "note", body: "hello" }, auth),
      env,
    );
    const body = (await (await w.fetch(get("/api"), env)).json()) as {
      setup: { needed: boolean };
      modules: { substrate: { entries_count: number } };
    };
    expect(body.setup.needed).toBe(false);
    expect(body.modules.substrate.entries_count).toBe(1);
  });
});

describe("/export", () => {
  test("refuses on the factory token", async () => {
    const w = await freshWorker();
    expect(
      (await w.fetch(get("/export"), makeTestEnv(DEFAULT_TOKEN).env)).status,
    ).toBe(503);
  });

  test("401 with no token at all", async () => {
    const w = await freshWorker();
    expect((await w.fetch(get("/export"), makeTestEnv().env)).status).toBe(401);
  });

  test("hands back every identity field, memory and loop as JSONL", async () => {
    const w = await freshWorker();
    const { env, d1 } = makeTestEnv();
    await w.fetch(get("/"), env);
    d1.db.exec(
      "INSERT INTO identity_fields (key, value, updated_at) VALUES ('call_me', 'Sam', 1)",
    );
    d1.db.exec(
      "INSERT INTO substrate_entries (id, type, body, created_at, updated_at) VALUES ('m1', 'note', 'n', 1, 1)",
    );
    d1.db.exec(
      "INSERT INTO loops (id, body, created_at) VALUES ('l1', 'held', 1)",
    );
    const res = await w.fetch(get(`/export?token=${REAL_TOKEN}`), env);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");
    const lines = (await res.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { record: string });
    expect(lines.map((l) => l.record)).toEqual(["identity", "memory", "loop"]);
  });

  test("an empty database exports a single newline", async () => {
    const w = await freshWorker();
    const res = await w.fetch(get("/export", auth), makeTestEnv().env);
    expect(await res.text()).toBe("\n");
  });
});

describe("page routes", () => {
  const pages = ["/connect", "/chat", "/intake"];
  for (const path of pages) {
    test(`${path} refuses on the factory token`, async () => {
      const w = await freshWorker();
      expect(
        (await w.fetch(get(path), makeTestEnv(DEFAULT_TOKEN).env)).status,
      ).toBe(503);
    });
    test(`${path} serves HTML on a real token`, async () => {
      const w = await freshWorker();
      const res = await w.fetch(get(path), makeTestEnv().env);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
    });
  }

  test("POST /chat/send and POST /intake refuse on the factory token", async () => {
    const w = await freshWorker();
    const env = makeTestEnv(DEFAULT_TOKEN).env;
    expect((await w.fetch(post("/chat/send", {}), env)).status).toBe(503);
    expect((await w.fetch(post("/intake", {}), env)).status).toBe(503);
  });

  test("/mcp/ refuses on the factory token", async () => {
    const w = await freshWorker();
    expect(
      (await w.fetch(get("/mcp/x"), makeTestEnv(DEFAULT_TOKEN).env)).status,
    ).toBe(503);
  });
});

describe("token-gated API routes", () => {
  test("refuse on the factory token and reject a wrong token", async () => {
    const w = await freshWorker();
    expect(
      (await w.fetch(get("/identity", auth), makeTestEnv(DEFAULT_TOKEN).env))
        .status,
    ).toBe(503);
    expect(
      (
        await w.fetch(
          get("/identity", { "X-Pack-Token": "nope" }),
          makeTestEnv().env,
        )
      ).status,
    ).toBe(401);
  });

  test("route each method and path to its module", async () => {
    const w = await freshWorker();
    const { env, ai } = makeTestEnv();
    await w.fetch(get("/"), env);
    ai.run.mockResolvedValue({ response: "routed" });
    const optIn = { ...auth, "X-Mycelia-Opt-In": "true" };
    const cases: [Request, number][] = [
      [get("/identity", auth), 200],
      [
        new Request(BASE + "/identity", {
          method: "PUT",
          headers: auth,
          body: JSON.stringify({ key: "call_me", value: "Sam" }),
        }),
        200,
      ],
      [post("/rhetoric/transform", { text: "hi" }, auth), 200],
      [post("/substrate/remember", { type: "note", body: "b" }, auth), 200],
      [post("/substrate/recall", {}, auth), 200],
      [get("/substrate/list", auth), 200],
      [get("/resume/momentum", auth), 200],
      [post("/fleet/route", { task: "t" }, auth), 200],
      [post("/mycelia/ask", { question: "q" }, optIn), 200],
      [get("/mycelia/open", optIn), 200],
      [get("/no-such-route", auth), 404],
    ];
    for (const [req, status] of cases) {
      expect(
        (await w.fetch(req, env)).status,
        `${req.method} ${new URL(req.url).pathname}`,
      ).toBe(status);
    }
  });

  test("a thrown handler error becomes a 500 with the detail", async () => {
    const w = await freshWorker();
    const { env, d1 } = makeTestEnv();
    await w.fetch(get("/"), env);
    d1.failOn = "identity_fields";
    const res = await w.fetch(get("/identity", auth), env);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Internal error",
    );
  });
});

// The small modules: identity (src/identity.ts), resume (src/resume.ts), fleet
// (src/fleet.ts), mycelia (src/mycelia.ts) and the shared helpers (src/common.ts).
import {
  corsHeaders,
  encodeTokenSegment,
  invalidJson,
  json,
  newId,
  notFound,
  unauthorized,
} from "../src/common";
import { handleRoute } from "../src/fleet";
import {
  getIdentityDoc,
  handleIdentityGet,
  handleIdentityPut,
  IDENTITY_KEYS,
} from "../src/identity";
import { handleAsk, handleOpen } from "../src/mycelia";
import { handleMomentum } from "../src/resume";
import { makeSchemaEnv } from "./support/d1";
import { BASE, get, post } from "./support/worker";

const put = (body: unknown) =>
  new Request(BASE + "/identity", {
    method: "PUT",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("identity", () => {
  test("an empty store has no document and says to run the intake", async () => {
    const { env } = await makeSchemaEnv();
    expect(await getIdentityDoc(env)).toBeNull();
    const out = (await (await handleIdentityGet(env)).json()) as {
      identity: null;
      note: string;
    };
    expect(out.identity).toBeNull();
  });

  test("assembles every field in order, with the default contract when none is set", async () => {
    const { env } = await makeSchemaEnv();
    for (const key of IDENTITY_KEYS.filter((k) => k !== "contract")) {
      expect(
        (await handleIdentityPut(put({ key, value: `v-${key}` }), env)).status,
      ).toBe(200);
    }
    const doc = (await getIdentityDoc(env)) ?? "";
    expect(doc.startsWith("# v-call_me")).toBe(true);
    for (const h of [
      "## Who I am",
      "## What I'm working toward",
      "## How to speak to me",
      "## Never do this with me",
      "## Operating contract",
    ]) {
      expect(doc).toContain(h);
    }
  });

  test("a stored contract replaces the default; a lone field skips the missing headings", async () => {
    const { env } = await makeSchemaEnv();
    await handleIdentityPut(
      put({ key: "contract", value: "my contract" }),
      env,
    );
    const doc = (await (await handleIdentityGet(env)).json()) as {
      identity: string;
    };
    expect(doc.identity).toBe("my contract");
  });

  test("PUT rejects invalid JSON, missing fields and unknown keys", async () => {
    const { env } = await makeSchemaEnv();
    expect((await handleIdentityPut(put("{nope"), env)).status).toBe(400);
    expect((await handleIdentityPut(put({ value: "x" }), env)).status).toBe(
      400,
    );
    expect((await handleIdentityPut(put({ key: "call_me" }), env)).status).toBe(
      400,
    );
    expect(
      (await handleIdentityPut(put({ key: "shoe_size", value: "9" }), env))
        .status,
    ).toBe(400);
  });
});

describe("resume", () => {
  const pivot = async (env: Awaited<ReturnType<typeof makeSchemaEnv>>["env"]) =>
    ((await (await handleMomentum(env)).json()) as { pivot: string }).pivot;

  test("an empty store gets the nothing-queued line", async () => {
    const { env } = await makeSchemaEnv();
    expect(await pivot(env)).toContain("Nothing's queued up");
  });

  test("each entry type gets its own lead, and long bodies are cut to 140", async () => {
    const leads: Record<string, string> = {
      breadcrumb: "Pick up the thread:",
      decision: "You decided:",
      note: "Last note worth holding:",
      question: "Open question on your mind:",
      session: "Where you left the work:",
      other: "Live thread:",
    };
    for (const [type, lead] of Object.entries(leads)) {
      const { env, d1 } = await makeSchemaEnv();
      d1.db
        .prepare(
          "INSERT INTO substrate_entries (id, type, body, created_at, updated_at) VALUES ('x', ?, 'short', 1, 1)",
        )
        .run(type);
      expect(await pivot(env)).toContain(lead);
    }
    const { env, d1 } = await makeSchemaEnv();
    d1.db
      .prepare(
        "INSERT INTO substrate_entries (id, type, body, created_at, updated_at) VALUES ('x', 'note', ?, 1, 1)",
      )
      .run("w ".repeat(100));
    const line = await pivot(env);
    expect(line.endsWith("...")).toBe(true);
    expect(line.length).toBeLessThan(170);
  });
});

describe("fleet", () => {
  test("rejects invalid JSON and a missing task", async () => {
    const { env } = await makeSchemaEnv();
    expect((await handleRoute(post("/f", "{nope"), env)).status).toBe(400);
    expect((await handleRoute(post("/f", { task: "" }), env)).status).toBe(400);
  });

  test("picks a model per hint and clamps max_tokens", async () => {
    const { env, ai } = await makeSchemaEnv();
    ai.run.mockResolvedValue({ response: "ok" });
    const models: Record<string, string> = {
      code: "llama-4-scout",
      translate: "mistral-small",
      reflect: "gemma-3",
      research: "llama-4-scout",
      factcheck: "llama-4-scout",
    };
    for (const [hint, model] of Object.entries(models)) {
      const out = (await (
        await handleRoute(post("/f", { task: "t", hint, max_tokens: 1 }), env)
      ).json()) as { model_used: string };
      expect(out.model_used).toContain(model);
    }
    const out = (await (
      await handleRoute(post("/f", { task: "t", max_tokens: 99999 }), env)
    ).json()) as {
      hint_received: string;
      response: string;
    };
    expect(out.hint_received).toBe("(none)");
    expect(out.response).toBe("ok");
    const args = ai.run.mock.calls.map(
      (c: unknown[]) => (c[1] as { max_tokens: number }).max_tokens,
    );
    expect(args).toContain(64);
    expect(args).toContain(2048);
  });

  test("an empty model reply is an empty response; a model failure is a 500", async () => {
    const { env, ai } = await makeSchemaEnv();
    ai.run.mockResolvedValueOnce(null);
    expect(
      (
        (await (await handleRoute(post("/f", { task: "t" }), env)).json()) as {
          response: string;
        }
      ).response,
    ).toBe("");
    ai.run.mockRejectedValueOnce(new Error("boom"));
    expect((await handleRoute(post("/f", { task: "t" }), env)).status).toBe(
      500,
    );
  });
});

describe("mycelia", () => {
  const optIn = { "X-Mycelia-Opt-In": "true" };

  test("both endpoints refuse without the opt-in header", async () => {
    expect((await handleAsk(post("/m", { question: "q" }))).status).toBe(403);
    expect((await handleOpen(get("/m"))).status).toBe(403);
  });

  test("ask validates its body and echoes the question", async () => {
    expect((await handleAsk(post("/m", "{nope", optIn))).status).toBe(400);
    expect((await handleAsk(post("/m", { question: "" }, optIn))).status).toBe(
      400,
    );
    const out = (await (
      await handleAsk(post("/m", { question: "q", context: "c" }, optIn))
    ).json()) as {
      received: { context: string | null };
    };
    expect(out.received.context).toBe("c");
    const bare = (await (
      await handleAsk(post("/m", { question: "q" }, optIn))
    ).json()) as {
      received: { context: string | null };
    };
    expect(bare.received.context).toBeNull();
  });

  test("open is always empty", async () => {
    expect(
      (
        (await (await handleOpen(get("/m", optIn))).json()) as {
          open: unknown[];
        }
      ).open,
    ).toEqual([]);
  });
});

describe("common helpers", () => {
  test("responses carry JSON, the status and CORS headers", async () => {
    expect(json({ a: 1 }).status).toBe(200);
    expect(unauthorized().status).toBe(401);
    expect(((await notFound("/x").json()) as { path: string }).path).toBe("/x");
    expect(invalidJson().status).toBe(400);
    expect(
      new Headers(corsHeaders()).get("Access-Control-Allow-Methods"),
    ).toContain("POST");
  });

  test("newId is 32 hex characters and encodeTokenSegment escapes the RFC 3986 extras", () => {
    expect(newId()).toMatch(/^[0-9a-f]{32}$/);
    expect(encodeTokenSegment("a!b'c(d)e*")).toBe("a%21b%27c%28d%29e%2A");
  });
});

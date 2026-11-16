// Chat (src/chat.ts) and intake (src/intake.ts) against a real-SQLite D1 and a stubbed
// Workers AI: the token check, the system prompt by identity state, memory recall,
// the [[SAVE]]/[[REMEMBER]] markers with and without pilot mode, and intake seeding.
import { absorbMarkers, handleChatSend } from "../src/chat";
import { handleIntakeSubmit } from "../src/intake";
import { makeSchemaEnv, REAL_TOKEN, type TestEnv } from "./support/d1";
import { post } from "./support/worker";

type SentMessages = { messages: { role: string; content: string }[] };

function systemPromptOf(t: TestEnv, call = 0): string {
  return (t.ai.run.mock.calls[call][1] as SentMessages).messages[0].content;
}

async function send(t: TestEnv, body: unknown): Promise<Response> {
  return handleChatSend(post("/chat/send", body), t.env);
}

describe("handleChatSend", () => {
  test("rejects invalid JSON, a bad token and an empty conversation", async () => {
    const t = await makeSchemaEnv();
    expect((await send(t, "{nope")).status).toBe(400);
    expect((await send(t, { token: "nope", messages: [] })).status).toBe(401);
    expect((await send(t, { token: REAL_TOKEN })).status).toBe(400);
    expect(
      (
        await send(t, {
          token: REAL_TOKEN,
          messages: [
            { role: "system", content: "x" },
            { role: "user", content: 5 },
          ],
        })
      ).status,
    ).toBe(400);
  });

  test("an empty pot interviews; the model's empty reply is a 502", async () => {
    const t = await makeSchemaEnv();
    t.ai.run.mockResolvedValueOnce({});
    expect(
      (
        await send(t, {
          token: REAL_TOKEN,
          messages: [{ role: "user", content: "hello" }],
        })
      ).status,
    ).toBe(502);
    expect(systemPromptOf(t)).toContain("this conversation IS the intake");
  });

  test("with an identity, the prompt carries it plus recalled memories, and the OpenAI-shaped reply is read", async () => {
    const t = await makeSchemaEnv();
    t.d1.db.exec(
      "INSERT INTO identity_fields (key, value, updated_at) VALUES ('call_me', 'Sam', 1)",
    );
    t.d1.db.exec(
      "INSERT INTO substrate_entries (id, type, body, created_at, updated_at) VALUES ('m', 'context', 'bikes in the woods', 1, 1)",
    );
    t.d1.db.exec(
      "INSERT INTO entries_fts (body, entry_id, type) VALUES ('bikes in the woods', 'm', 'context')",
    );
    t.ai.run.mockResolvedValueOnce({
      choices: [{ message: { content: "hi Sam" } }],
    });
    const res = await send(t, {
      token: REAL_TOKEN,
      messages: [
        { role: "user", content: "ok" },
        { role: "assistant", content: "yes" },
        { role: "user", content: "tell me about bikes" },
      ],
    });
    expect(((await res.json()) as { reply: string }).reply).toBe("hi Sam");
    const sys = systemPromptOf(t);
    expect(sys).toContain("# Sam");
    expect(sys).toContain("- [context] bikes in the woods");
  });

  test("recall is skipped for short words and survives a search failure", async () => {
    const t = await makeSchemaEnv();
    t.d1.db.exec(
      "INSERT INTO identity_fields (key, value, updated_at) VALUES ('call_me', 'Sam', 1)",
    );
    t.ai.run.mockResolvedValue({ response: "fine" });
    await send(t, {
      token: REAL_TOKEN,
      messages: [{ role: "user", content: "hi yo" }],
    });
    expect(systemPromptOf(t, 0)).not.toContain("POSSIBLY RELEVANT");
    t.d1.failOn = "entries_fts";
    expect(
      (
        await send(t, {
          token: REAL_TOKEN,
          messages: [{ role: "user", content: "longer words here" }],
        })
      ).status,
    ).toBe(200);
    expect(systemPromptOf(t, 1)).not.toContain("POSSIBLY RELEVANT");
    // A conversation with only an assistant turn has no user text to recall from.
    t.d1.failOn = undefined;
    await send(t, {
      token: REAL_TOKEN,
      messages: [{ role: "assistant", content: "hello there" }],
    });
    expect(systemPromptOf(t, 2)).not.toContain("POSSIBLY RELEVANT");
  });
});

describe("absorbMarkers", () => {
  test("stores approved fields and memories and strips every marker", async () => {
    const t = await makeSchemaEnv();
    const reply =
      "Got it.\n[[SAVE:call_me=Sam]]\n\n\n\n[[SAVE:shoe=9]][[SAVE:who_i_am=  ]]\n[[REMEMBER:likes maps]][[REMEMBER:  ]]\nNext?";
    expect(await absorbMarkers(t.env, reply)).toBe("Got it.\n\nNext?");
    expect(
      t.d1.db.prepare("SELECT key, value FROM identity_fields").all(),
    ).toEqual([{ key: "call_me", value: "Sam" }]);
    expect(t.d1.db.prepare("SELECT body FROM substrate_entries").all()).toEqual(
      [{ body: "likes maps" }],
    );
  });

  test("a reply with no markers writes nothing", async () => {
    const t = await makeSchemaEnv();
    expect(await absorbMarkers(t.env, " plain ")).toBe("plain");
    expect(
      t.d1.db.prepare("SELECT COUNT(*) AS n FROM identity_fields").get()?.n,
    ).toBe(0);
  });

  test("pilot mode strips the markers and writes nothing", async () => {
    const t = await makeSchemaEnv(REAL_TOKEN, { MEMORY_WRITES: "off" });
    expect(
      await absorbMarkers(
        t.env,
        "a [[SAVE:call_me=Sam]]\n\n\n[[REMEMBER:x]] b",
      ),
    ).toBe("a \n\n b");
    expect(
      t.d1.db.prepare("SELECT COUNT(*) AS n FROM identity_fields").get()?.n,
    ).toBe(0);
  });
});

describe("handleIntakeSubmit", () => {
  const submit = (t: TestEnv, body: unknown) =>
    handleIntakeSubmit(post("/intake", body), t.env);

  test("rejects invalid JSON, a bad token and an empty form", async () => {
    const t = await makeSchemaEnv();
    expect((await submit(t, "{nope")).status).toBe(400);
    expect((await submit(t, { token: "nope" })).status).toBe(401);
    expect((await submit(t, { token: REAL_TOKEN, call_me: "  " })).status).toBe(
      400,
    );
  });

  test("seeds answered fields and one memory per line, capped at 50", async () => {
    const t = await makeSchemaEnv();
    const lines = Array.from({ length: 60 }, (_, i) => `memory ${i}`).join(
      "\n",
    );
    const res = await submit(t, {
      token: REAL_TOKEN,
      call_me: "Sam",
      who_i_am: "rider",
      seed_memories: `${lines}\n\n`,
    });
    const out = (await res.json()) as {
      seeded: { identity_fields: number; memories: number };
      mcp_url: string;
    };
    expect(out.seeded).toEqual({ identity_fields: 2, memories: 50 });
    expect(out.mcp_url).toBe(`https://pack.example/mcp/${REAL_TOKEN}`);
    expect(
      t.d1.db.prepare("SELECT COUNT(*) AS n FROM entries_fts").get()?.n,
    ).toBe(50);
  });
});

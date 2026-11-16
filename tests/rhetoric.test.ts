// Rhetoric module (src/rhetoric.ts): each transform, the warnings, and input validation,
// asserted on the text the endpoint returns.
import { handleTransform } from "../src/rhetoric";
import { post } from "./support/worker";

type Out = { text: string; applied: string[]; warnings: string[] };

async function transform(body: unknown): Promise<Out> {
  return (await (
    await handleTransform(post("/rhetoric/transform", body))
  ).json()) as Out;
}

const long = (w: string) => Array.from({ length: 30 }, () => w).join(" ");

describe("handleTransform", () => {
  test("rejects invalid JSON and non-string text", async () => {
    expect((await handleTransform(post("/t", "{nope"))).status).toBe(400);
    expect((await handleTransform(post("/t", { text: 5 }))).status).toBe(400);
  });

  test("blank input comes back empty with a warning", async () => {
    expect(await transform({ text: "   " })).toEqual({
      text: "",
      applied: [],
      warnings: ["empty-input"],
    });
  });

  test("plain short text passes through untouched", async () => {
    expect(await transform({ text: "Hello there." })).toEqual({
      text: "Hello there.",
      applied: [],
      warnings: [],
    });
  });

  test("strips emoji from headers and bullets", async () => {
    const out = await transform({ text: "## 🚀 Launch\n- ✅ done" });
    expect(out.text).toBe("## Launch\n- done");
    expect(out.applied).toEqual(["strip-emoji-headers", "strip-emoji-bullets"]);
  });

  test("splits a long sentence on a semicolon or comma", async () => {
    const out = await transform({ text: `${long("word")}; ${long("more")}` });
    expect(out.applied).toContain("split-long-sentences");
    expect(out.text).toContain(". more");
  });

  test("falls back to a comma-conjunction split, capitalizing each new sentence", async () => {
    // A tab after the comma slips past the ", " splitter and reaches the conjunction one.
    const out = await transform({
      text: `${long("word")},\tand ${long("more")},\tbut `,
    });
    expect(out.applied).toContain("split-long-sentences");
    expect(out.text).toContain(". More");
  });

  test("a long sentence with no split point is counted as unsplittable", async () => {
    const out = await transform({ text: long("word") });
    expect(out.warnings).toEqual(["unsplittable-long-sentences: 1"]);
  });

  test("structural lines are never split", async () => {
    const lines = [
      "```",
      "    " + long("x"),
      "# " + long("h"),
      "- " + long("b"),
      "1. " + long("n"),
    ];
    const out = await transform({ text: lines.join("\n") });
    expect(out.applied).not.toContain("split-long-sentences");
    expect(out.warnings).toEqual([]);
  });

  test("code fences are unwrapped only in chat context", async () => {
    const text = "Look:\n```ts\nconst a = 1;\n```";
    expect((await transform({ text, context: "chat" })).text).toBe(
      "Look:\nconst a = 1;",
    );
    expect((await transform({ text, context: "doc" })).text).toBe(text);
  });

  test("runs of blank lines collapse to one", async () => {
    const out = await transform({ text: "a\n\n\n\nb" });
    expect(out.text).toBe("a\n\nb");
    expect(out.applied).toEqual(["collapse-blank-lines"]);
  });
});

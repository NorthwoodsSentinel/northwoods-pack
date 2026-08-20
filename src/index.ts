/**
 * northwoods-pack — modular monolith
 *
 * Single Worker housing 5 capability modules:
 *   /rhetoric/transform   — output transformer (POST)
 *   /substrate/remember   — store memory entry (POST)
 *   /substrate/recall     — search memory (POST)
 *   /substrate/list       — list by tag/type (GET)
 *   /resume/momentum      — momentum-restart pivot (GET)
 *   /fleet/route          — Workers AI router (POST)
 *   /mycelia/ask          — opt-in help post (POST)
 *   /mycelia/open         — opt-in help list (GET)
 *   /                     — pack info + module status (GET)
 *
 * This is the 1-click Deploy Button shape for v0.2.
 * The 5-Worker version (workers/northwoods-{rhetoric,substrate,resume,fleet,mycelia}/)
 * stays available as the "enterprise tier" for orgs that want per-Worker isolation.
 */

import {
  corsHeaders,
  json,
  unauthorized,
  notFound,
  Env,
} from "./common";
import { handleTransform } from "./rhetoric";
import {
  handleRemember,
  handleRecall,
  handleList,
  entryCount,
} from "./substrate";
import { handleMomentum } from "./resume";
import { handleRoute } from "./fleet";
import { handleAsk, handleOpen } from "./mycelia";
import { handleIdentityGet, handleIdentityPut } from "./identity";
import { handleIntakeForm, handleIntakeSubmit } from "./intake";
import { handleMcp } from "./mcp";
import { ensureSchema, tokenIsDefault, TOKEN_HELP } from "./setup";

async function info(env: Env): Promise<Response> {
  const needsToken = tokenIsDefault(env);
  let count = 0;
  try {
    count = await entryCount(env);
  } catch {
    /* DB may not be migrated yet */
  }
  return json({
    pack: "northwoods-pack",
    setup: needsToken ? { needed: true, how: TOKEN_HELP } : { needed: false },
    version: "0.4.0",
    purpose:
      "Public PAI v0.3 — 1 Worker, 1-click install: identity + intake interview + MCP, so your AI knows you in ten minutes.",
    modules: {
      rhetoric: { paths: ["POST /rhetoric/transform"] },
      substrate: {
        paths: [
          "POST /substrate/remember",
          "POST /substrate/recall",
          "GET /substrate/list?tag=X&type=Y",
        ],
        entries_count: count,
      },
      resume: { paths: ["GET /resume/momentum"] },
      fleet: { paths: ["POST /fleet/route"] },
      mycelia: {
        paths: ["POST /mycelia/ask", "GET /mycelia/open"],
        opt_in_header: "X-Mycelia-Opt-In: true (required per request)",
      },
      identity: { paths: ["GET /identity", "PUT /identity"] },
      intake: { paths: ["GET /intake (the interview)", "POST /intake"] },
      mcp: {
        paths: ["POST /mcp/:token — MCP server (get_identity, recall_memories, remember, correct_me)"],
        felt_win: "paste your MCP URL into Claude or any MCP client; your AI knows you",
      },
    },
    doctrine: {
      audience_is_strong: "no user attributes named to the AI",
      substrate_is_product: "your data on your CF account",
      same_surface: "what helps one helps any",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Public info endpoint (no auth)
    if (method === "GET" && (path === "/" || path === "")) {
      return info(env);
    }
    // Intake interview: the form is public to render; the submit checks the
    // token in its body. MCP checks the token in its path. Both self-auth so
    // chat clients and browsers that can't set headers still work.
    if (method === "GET" && path === "/intake") {
      if (tokenIsDefault(env)) return json({ setup_needed: TOKEN_HELP }, 503);
      await ensureSchema(env);
      return handleIntakeForm();
    }
    if (method === "POST" && path === "/intake") {
      if (tokenIsDefault(env)) return json({ error: TOKEN_HELP }, 503);
      await ensureSchema(env);
      return await handleIntakeSubmit(request, env);
    }
    if (path.startsWith("/mcp/")) {
      if (tokenIsDefault(env)) return json({ error: TOKEN_HELP }, 503);
      await ensureSchema(env);
      return await handleMcp(request, env, path.slice("/mcp/".length));
    }

    // Auth check for everything else
    const token = request.headers.get("X-Pack-Token");
    if (!token || token !== env.DEMO_TOKEN) {
      return unauthorized();
    }

    try {
      // --- identity ---
      if (method === "GET" && path === "/identity") {
        return await handleIdentityGet(env);
      }
      if (method === "PUT" && path === "/identity") {
        return await handleIdentityPut(request, env);
      }
      // --- rhetoric ---
      if (method === "POST" && path === "/rhetoric/transform") {
        return await handleTransform(request, env);
      }
      // --- substrate ---
      if (method === "POST" && path === "/substrate/remember") {
        return await handleRemember(request, env);
      }
      if (method === "POST" && path === "/substrate/recall") {
        return await handleRecall(request, env);
      }
      if (method === "GET" && path === "/substrate/list") {
        return await handleList(url, env);
      }
      // --- resume ---
      if (method === "GET" && path === "/resume/momentum") {
        return await handleMomentum(env);
      }
      // --- fleet ---
      if (method === "POST" && path === "/fleet/route") {
        return await handleRoute(request, env);
      }
      // --- mycelia ---
      if (method === "POST" && path === "/mycelia/ask") {
        return await handleAsk(request, env);
      }
      if (method === "GET" && path === "/mycelia/open") {
        return await handleOpen(request, env);
      }
    } catch (err) {
      return json({ error: "Internal error", detail: String(err) }, 500);
    }

    return notFound(path);
  },
};

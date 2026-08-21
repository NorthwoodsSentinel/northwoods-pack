// The last thing every install log says is what to do next.
// Runs `wrangler deploy`, mirrors its output, catches the workers.dev URL,
// and closes the log with the walk-in instructions. Born 2026-08-21 after a
// live install ended on "Success: Deploy command" and the person deploying
// had to ask a human what came next. The install prompts; the person never asks.
import { spawn } from "node:child_process";

const args = process.argv.slice(2); // passthrough, e.g. --config wrangler.ref.toml
const child = spawn("wrangler", ["deploy", ...args], { stdio: ["inherit", "pipe", "inherit"] });

let captured = "";
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  captured += chunk.toString();
});

child.on("close", (code) => {
  if (code !== 0) process.exit(code ?? 1);
  const m = captured.match(/https:\/\/[^\s]+\.workers\.dev/);
  const url = m ? m[0] : "the .workers.dev link printed above";
  const line = "=".repeat(62);
  console.log(`
${line}
  YOUR HARNESS IS ALIVE. HERE IS YOUR NEXT STEP.

  1. Open:  ${url}
  2. Pick your door:
       "Talk to it"  ->  ${m ? url + "/chat" : "/chat"}
       (no AI setup? this one. It asks, you answer.)
       "Connect it"  ->  ${m ? url + "/connect" : "/connect"}
       (already run Claude Code / PAI / anything MCP? this one.)
  3. It asks for your token ONCE: that is the same string you
     pasted into the DEMO_TOKEN box during setup. Lost it?
     You own this - set a new one in your Cloudflare dashboard
     (this Worker -> Settings -> Variables and Secrets).
     Your memories stay.

  That is the whole install. From here you just talk.
${line}
`);
});

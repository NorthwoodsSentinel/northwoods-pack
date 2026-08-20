# northwoods-pack

A small Cloudflare Worker that drops into stock **PAI 5.0** and adds five capabilities — running on **your own** Cloudflare account. Your substrate stays yours. Your data stays yours.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/NorthwoodsSentinel/northwoods-pack)

> Part of the [Northwoods stack](https://github.com/NorthwoodsSentinel) — substrate-first personal AI infrastructure on Cloudflare.

---

## Ten minutes to an AI that knows you

1. **Click Deploy** (button above). It creates the Worker + D1 database on **your** Cloudflare account.
   The pack ships locked with a factory token and **refuses to run** until you replace it (otherwise every install would share one public key). Open your new Worker → Settings → Variables and Secrets → set `DEMO_TOKEN` to any long random string. The worker's own error message walks you through this too.
   Fresh database? No migrations to run — the pack builds its own tables on first touch.
2. **Open `https://<your-worker>.workers.dev/intake`** and answer five questions in your own words — who you are, what you're chasing, how an AI should speak to you, what it must never do, and anything it should already remember.
3. **Paste your MCP URL** (shown when the interview saves) into Claude — Settings → Connectors — or any MCP client.

That's it. Your AI now reads *your* identity first, recalls *your* memories, and stores new ones — all in a database you own, on an account you control, changeable or deletable by you alone. No vendor holds your self.

## What it does

Eight modules, one Worker, one URL on your CF account:

| Module | Endpoint | Purpose |
|---|---|---|
| **rhetoric** | `POST /rhetoric/transform` | Output transformer — strips emoji-headed sections, splits long sentences on coordinating conjunctions, removes code blocks from chat context. Preserves adult vocabulary. |
| **substrate** | `POST /substrate/remember`, `POST /substrate/recall`, `GET /substrate/list` | Persistent memory store backed by D1. Query, tag, retrieve. |
| **resume** | `GET /resume/momentum` | Single forward-leaning sentence answering "where was I." Never timestamps. Never task lists. Never verdicts about absence. |
| **fleet** | `POST /fleet/route` | Workers AI model router. Default Llama 4 Scout (US residency). Route hints select Mistral / Gemma for translate / reflect. |
| **mycelia** | `POST /mycelia/ask`, `GET /mycelia/open` | Optional cross-fleet help channel. Off by default — every request requires `X-Mycelia-Opt-In: true` header. |
| **identity** | `GET /identity`, `PUT /identity` | The Layer-3 store: who you are, decision principles, voice rules, anti-rules. What an AI reads first. |
| **intake** | `GET /intake` | The first-run interview. Seeds identity + starter memories so the pot never ships empty. |
| **mcp** | `POST /mcp/:token` | MCP server: `get_identity`, `recall_memories`, `remember`. One URL makes any MCP-capable AI yours. |

### Sibling pack: [muckers](https://github.com/NorthwoodsSentinel/muckers)

For operators running a many-agent fleet who need the operational discipline that fourteen lab assistants gave Edison — see [`muckers`](https://github.com/NorthwoodsSentinel/muckers). Five primitives (digest, organizer, STANDING_RULES, AGENDA, dual-mode) named after Edison's team. Separate deployable Worker, composes with this pack's substrate D1 binding.

---

## Why it exists

PAI 5.0 ships an empty pot. This pack fills it with capabilities tuned for people whose AI experience needs to fit *them* — not the other way around.

The accommodations live in the Worker, downstream of the AI. The AI greets you as a person; the Worker shapes what reaches you. You won't find a system prompt anywhere in this pack that names a user's constraints. That's intentional — care that reads as a permanent medical chart is not care.

This is Public PAI v0.2. It descends from a small private pack built in collaboration with one specific user and then generalized into what every cohort member gets. Same shape for the kid in the school, the mother in the shelter, the immigrant at the resettlement office, the worker between jobs.

Read [DOCTRINE.md](DOCTRINE.md) for the design principles this pack honors.

---

## Install

### Option A — 1-click (recommended)

Click the **Deploy to Cloudflare** button above. CF clones this repo to your account, provisions D1 + KV, deploys the Worker. After deploy:

1. Open the Worker in your CF dashboard and copy its URL (`https://northwoods-pack.YOUR-SUBDOMAIN.workers.dev`)
2. Update the `DEMO_TOKEN` variable to a real token: `openssl rand -hex 32` → CF dashboard → Worker → Variables → edit
3. Apply the D1 schema:
   ```bash
   wrangler d1 execute northwoods-substrate --remote --file=migrations/0001_init.sql
   ```
4. Copy the 5 SKILL.md files into your PAI 5.0:
   ```bash
   cp -r pai-skills/* ~/.claude/skills/
   ```
5. Create `~/.claude/PAI/USER/SKILLCUSTOMIZATIONS/NorthwoodsPack/CONFIG.md` (see template below) with your URL and token.

### Option B — Manual (wrangler CLI)

```bash
git clone https://github.com/NorthwoodsSentinel/northwoods-pack.git
cd northwoods-pack
bun add -g wrangler  # or: npm install -g wrangler
wrangler login

# Create your resources
wrangler d1 create northwoods-substrate    # paste the database_id into wrangler.toml
wrangler kv namespace create NORTHWOODS_PREFS  # paste the id into wrangler.toml
wrangler d1 execute northwoods-substrate --remote --file=migrations/0001_init.sql

# Generate a token and edit wrangler.toml DEMO_TOKEN
openssl rand -hex 32

# Deploy
wrangler deploy
```

Then copy the SKILL.md files + create your CONFIG.md as in Option A steps 4-5.

---

## CONFIG.md template

```yaml
pack:
  url:   https://northwoods-pack.YOUR-SUBDOMAIN.workers.dev
  token: YOUR-GENERATED-TOKEN

paths:
  rhetoric:  /rhetoric/transform
  substrate: /substrate
  resume:    /resume/momentum
  fleet:     /fleet/route
  mycelia:   /mycelia

defaults:
  rhetoric_context: chat
  fleet_default_model: claude
  mycelia_enabled: false
```

---

## Sovereignty

- **Your CF account, not ours.** Workers, D1, KV — all on your account.
- **Your data, your control.** Substrate entries live in your D1. Delete the database, delete your substrate. No backend of ours holds copies.
- **No telemetry.** This pack does not phone home. It calls Workers AI on your account; it does not call us.
- **Portable.** Everything here is yours to read, change, fork, run, or replace.

---

## Verify

```bash
TOKEN="<your-token>"
URL="https://northwoods-pack.YOUR-SUBDOMAIN.workers.dev"

curl -s "$URL/" | jq .

curl -s -X POST "$URL/rhetoric/transform" \
  -H "Content-Type: application/json" \
  -H "X-Pack-Token: $TOKEN" \
  -d '{"text":"## 🎯 Hi","context":"chat"}' | jq .
```

If both return JSON (info object + transformed text with emoji stripped), you're done.

---

## Troubleshooting

Real install gotchas, captured from the first end-to-end Deploy Button install. If you hit any of these, it's not you — it's the path. Fixes below.

### 1. Deploy Button fails with *"Cloudflare could not create the Git repository"*

**Cause:** The Cloudflare Workers & Pages GitHub App needs two permissions it didn't have before December 2024: **Repository Administration** (to create repos) and **Contents** (to push to them). If you installed the GitHub App before then and never accepted the permission update, the Deploy Button can't create the destination repo on your behalf.

**Fix:**
1. Go to `https://github.com/settings/installations` (or `https://github.com/organizations/YOUR_ORG/settings/installations` for org-owned installs)
2. Find **Cloudflare Workers & Pages** → click **Configure**
3. Accept the new permissions
4. Retry the Deploy Button

### 2. Deploy Button complains the repo *"already exists"*

**Cause:** CF tries to create a destination repo with the same name as the source (`northwoods-pack`), which already exists on your account if you previously forked or imported it.

**Fix:** In the Deploy flow's *"Project name"* field, change it from `northwoods-pack` to something like `northwoods-pack-deploy` or `northwoods-pack-prod`. CF creates the new repo with that name and the deploy proceeds.

### 3. *"Enable read replication?"* — which to pick

**Pick: No.** Read replication is for apps serving many users across geographies. For a single-user pack on your own account, it adds storage overhead with zero perceptible latency win. You can enable it later if you scale.

### 4. After Deploy Button finishes, two manual steps remain

CF's Deploy Button auto-provisions the D1 + KV bindings but does NOT (a) run database migrations, (b) replace the placeholder `DEMO_TOKEN`. You have to do both manually after the Worker is live.

```bash
# 1. Apply the D1 schema
git clone https://github.com/YOUR_USERNAME/YOUR_DEPLOY_REPO.git
cd YOUR_DEPLOY_REPO
wrangler d1 execute northwoods-substrate --remote --file=migrations/0001_init.sql

# 2. Set a real token (in CF dashboard)
# Workers & Pages → your-worker → Settings → Variables and Secrets
# Find DEMO_TOKEN, click Edit, change Type from Plaintext to Secret,
# paste the output of: openssl rand -hex 32
# Save (CF redeploys in ~5 seconds)
```

### 5. Workers & Pages GitHub App asks: *"All repositories"* or *"Only select repositories"*?

**Pick: All repositories for the install, then tighten after.** The auto-create flow needs account-level write access — *"Only select"* can fail mid-deploy because CF can't push to a freshly-created repo that isn't in your selected list yet (chicken-and-egg).

**After install succeeds:** go back to the same GitHub settings page, switch CF Workers & Pages to *"Only select repositories,"* and add just the two repos that actually need it (the source you forked from + your deployed fork). Takes 30 seconds. Tightens the blast radius.

### 6. Worker returns 401 on every call

Token mismatch. The `DEMO_TOKEN` in your Worker's environment variables (CF dashboard) doesn't match the `auth.token` in your local `CONFIG.md`. They must be identical.

### 7. Skill not visible in PAI 5.0

Restart your `claude` session. Skills are loaded at session start; new SKILL.md files don't appear until next session.

---

## License

Apache 2.0. See [LICENSE](LICENSE). The license allows commercial redistribution; the social request is please don't repackage as your own product.

# Testing Waypoint

This is the runbook for anyone (human or AI agent) who has just cloned this
repository and needs to get it running and verified end to end. Read this
before touching code.

## 0. If you are an AI coding agent reading this automatically

Do these in order, and stop to ask the human for anything in §1 you don't
already have. Don't guess at credentials or silently skip a step because a
value is missing — ask once, plainly, for exactly what's missing.

1. Check whether `.env` exists. If not, copy `.env.example` to `.env`.
2. Read `.env` and compare against the table in §1. For every blank or
   placeholder value, ask the user for it (batch the questions, don't ask
   one at a time). Mention what each one unlocks so they know what to
   prioritize if they only have some of them.
3. Run §2 (install, start FalkorDB) regardless of what's missing — this
   doesn't need any secrets.
4. Run §3 (offline contract tests) — this also needs no secrets and should
   always pass on a clean checkout. If it doesn't, that's a real bug; report
   it, don't paper over it.
5. Run §4 (live eval) only if an AI provider key is present. If not, say so
   and move on instead of blocking.
6. Report results plainly: what passed, what failed, and — critically — any
   bug you found and fixed along the way, with the actual root cause, not a
   guess. See §6 for the pattern.

## 1. Environment variables

| Variable | Required for | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` | Everything (auth, workspaces, investigations, memory) | Supabase project dashboard → Settings → API / Database |
| `FALKORDB_URL` | Graph queries, MCP tools, Ask/Investigate flows | See §2 — a local Docker instance works, no account needed |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | Agent runner, Ask, eval harness | Any OpenAI-compatible provider — see §2.3 for a free option |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_STATE_SECRET` | GitHub source connector + action execution | A GitHub App you register — see `docs/operations-runbook.md` |

Everything except `FALKORDB_URL` and the GitHub App block normally arrives
already filled in via `.env` if you've pulled from someone who set this
project up before. `.env` is gitignored — it never arrives via `git pull`.
If it's missing entirely, ask the human directly; don't invent values.

## 2. Local setup

### 2.1 Install dependencies

This project uses Bun (`bun.lock` is the lockfile — never regenerate an
npm/yarn/pnpm one).

```bash
bun install
```

### 2.2 FalkorDB

**Cloud FalkorDB may not be reachable** — as of 2026-10-16 the configured
cloud endpoint doesn't resolve at all (`ENOTFOUND`). Until that's fixed,
run FalkorDB locally in Docker:

```bash
docker run -d --name falkordb -p 16379:6379 -p 3002:3000 -v falkordb_data:/data falkordb/falkordb:latest
```

Use port `16379` (not `6379`) on Windows especially — a native Redis
service often already squats the default port, and your client will
silently connect to the wrong server with no graph module loaded,
producing a confusing `ERR unknown command 'GRAPH.QUERY'`. Check with
`netstat -ano | grep 6379` before assuming the port is free.

Set in `.env`:
```
FALKORDB_URL=falkor://localhost:16379
```

(`falkor://` = plain/local, `falkors://` = TLS/cloud — the client in
`src/lib/falkordb.ts` supports both.)

Verify the client code actually works (not just the container):
```bash
node -e "require('redis')" 2>&1  # sanity: redis client is installed
```
There's no standalone local-connectivity script checked in (it was a throwaway
during debugging) — the real verification is `bun run test:graph-acl`, which
exercises the real client against FalkorDB over its ACL/read-path logic, and
`bun run eval:compare` in graph_agent mode, which issues real `GRAPH.QUERY`
calls end-to-end.

`bun run diagnose:falkordb` only works against a `falkors://` (TLS/cloud)
URL — it's cloud-specific and will reject a local `falkor://` URL. That's
intentional; don't "fix" it to accept local URLs, it's testing TLS reachability
specifically.

### 2.3 AI provider (for the agent runner and eval harness)

Any OpenAI-compatible chat-completions endpoint works. Groq has a free tier
and is the one used during this project's build:

```
AI_BASE_URL=https://api.groq.com/openai/v1
AI_API_KEY=<your groq key>
AI_MODEL=openai/gpt-oss-20b
```

**Use `gpt-oss-20b`, not `gpt-oss-120b`, for day-to-day testing.** Both
support tool-calling and share the same rate-limit pool, but `120b` is far
more likely to get throttled under repeated testing. Switch to `120b` (or a
real OpenAI model) only when you need the strongest reasoning, e.g. for a
final pre-submission eval run.

To switch providers later (e.g. once you have OpenAI credits), just replace
these three values — the code (`readModelConfig()` in `src/lib/agent-runner.ts`)
is fully provider-agnostic. No code changes needed. `.env` has a commented
OpenAI placeholder block ready to uncomment.

### 2.4 Apply database migrations (if needed)

If there's no linked Supabase CLI project (there isn't one in this repo —
no `supabase/config.toml`), apply new migrations directly against
`DATABASE_URL`:

```bash
bun run scripts/apply-migration.ts <filename>.sql
```

This connects with `ssl: { rejectUnauthorized: false }` — Supabase's
pooler cert chain isn't in Node's default trust store. That's expected,
not a security downgrade worth "fixing" — the connection string itself
is already the credential.

**Postgres gotcha:** `CREATE OR REPLACE FUNCTION` does **not** replace a
function if you change its parameter list — it silently creates a second
overload instead, leaving the old one behind. If you add a parameter to an
existing RPC, write a follow-up migration that explicitly
`DROP FUNCTION IF EXISTS name(old, param, types)` first. Verify with:

```sql
select r.specific_name, p.parameter_name
from information_schema.routines r
left join information_schema.parameters p on p.specific_name = r.specific_name
where r.routine_name = 'your_function_name'
order by r.specific_name, p.ordinal_position;
```

If you see more than one distinct `specific_name`, you have duplicate
overloads — clean them up.

## 3. Offline contract tests (no secrets needed)

```bash
bun run typecheck
bun run test:contracts
```

This runs `tsc --noEmit` plus ~21 scripts under `scripts/check-*.ts`, each
printing one confirmation line. These mock `fetch`/inputs and never touch
a real network — they should **always** pass on a clean checkout. If one
fails, it's a real regression, not an environment issue.

Run a single check directly when iterating: `bun run test:graph-acl`, etc.
— see `package.json` `scripts` for the full list.

## 4. Live evaluation (needs an AI provider key)

```bash
bun run eval:compare
```

This runs every case in `eval/*.json` through three retrieval strategies
(`graph_agent`, `text_retrieval`, `markdown_memory`) against the real model
and prints one JSON report. Useful env overrides while iterating:

```bash
AI_EVAL_MAX_CASES=1 bun run eval:compare        # just the first case
AI_EVAL_CONTEXT_BUDGET_BYTES=16000 bun run eval:compare
```

Read the output's `summary` (per-mode completed/failed counts and mean
scores) and `failures` (every failed case with its reason) first — the
full `results` array is for digging into a specific case.

**`eval/locomo-external.v1.json` is real external benchmark data** (adapted
from the LoCoMo paper/dataset), not synthetic — its `dataClass` is
`external_benchmark_locomo_subset`, distinct from the other two fixtures'
`synthetic_test_fixture_only`. Keep that distinction when citing eval
results anywhere (pitch, README, blog post) — don't claim synthetic-only
numbers cover it, and don't claim the LoCoMo subset alone proves the full
claim; report them separately or clearly labeled.

### 4.1 Expect this to take minutes, not seconds

Each case runs through 3 strategies; `graph_agent` can make up to 4 model
calls per case. With ~14 cases that's 50-70+ real network calls. Free-tier
rate limits mean some of these will retry. That's normal — don't assume a
long-running `eval:compare` is stuck. It genuinely isn't finished until you
see the final JSON blob (the script buffers everything and prints once at
the end — there's no streaming progress output by design, to keep the
report atomic).

If you genuinely suspect a hang (10+ minutes with zero output, and you've
confirmed the API key works with a direct `curl` test), see §6.2 for how
this was diagnosed last time — it wasn't actually a hang.

## 5. Full checklist before calling something "verified"

Don't mark a capability done based on code existing or typecheck passing.
These are the levels, from weakest to strongest — say which one you reached:

1. **Code compiles** (`bun run typecheck`) — proves almost nothing.
2. **Offline contract test passes** (`bun run test:contracts`) — proves the
   logic is internally consistent against mocked inputs.
3. **Live call against the real dependency succeeds** — e.g. a real
   `GRAPH.QUERY` against FalkorDB, a real Groq completion, a real Supabase
   row read. This is what actually matters for a hackathon submission.
4. **End-to-end user flow works in the browser** — sign in, ask a question,
   see an evidence path, approve an action. Nothing below this level should
   be described to a judge as "working."

When reporting status (to a human or in `IMPLEMENTATION_TRACKER.md`), say
which level you reached. "Typecheck passes" is not "it works."

## 6. Known gotchas (found by live-testing, already fixed — don't reintroduce)

These were real bugs found by actually running this code against a live
model and a live database, not by reading it. Keeping them here so nobody
"fixes" the fix.

### 6.1 `investigationId` must be told to the model, not guessed

`runToolSelectionLoop` in `src/lib/agent-runner.ts` rejects any tool call
where the model's `investigationId` argument doesn't match the real one —
but the model was never told the real one, so every graph-agent call failed
by design. Fixed by including `Active investigation ID: ${investigationId}`
in the first user message. If you see "Model attempted to call a tool
outside the active investigation" errors again, check this didn't regress.

### 6.2 `tool_choice` must be `"none"` when `tools` is empty

On the forced-final-answer turn (tool budget exhausted), the code used to
send `tools: []` with `tool_choice: "auto"` — some providers (Groq) reject
that combination outright. Fixed: `tool_choice` is `"none"` when `tools` is
empty. Additionally, some models (Groq's `gpt-oss` family) still *attempt*
a tool call even with `tool_choice: "none"`, which Groq then rejects with
`tool_use_failed`. That specific case is caught and converted into a
graceful abstention instead of a crash — look for
`isToolUseFailedWithNoToolsOffered` in `src/lib/agent-runner.ts`.

### 6.3 Respect `x-should-retry: false`, and cap retry waits

A 429 response can carry `retry-after: 378` (6+ minutes) alongside
`x-should-retry: false` — the provider explicitly saying "don't bother
retrying this one." The retry loop used to honor `retry-after` blindly,
which made the eval harness appear to hang for minutes per call. Fixed:
`completeWithModel` now skips retrying when `x-should-retry: false`, and
caps any retry wait at 20 seconds regardless of what `retry-after` asks
for. If something needs a longer cooldown, it should fail fast and let the
caller decide to retry later — not block synchronously.

This was diagnosed by adding temporary `console.error` tracing around the
`fetch` call and the 429 branch, not by guessing — if you hit something
that looks like a hang again, do the same: trace the actual request/response,
don't assume you know the cause.

### 6.4 Port 6379 conflicts on Windows

A native Windows Redis service can already be listening on `6379`,
silently intercepting FalkorDB's Docker port mapping if you map it to the
same host port. Symptom: `ERR unknown command 'GRAPH.QUERY'` even though
`docker exec falkordb redis-cli GRAPH.QUERY ...` works fine directly
(because that bypasses the port mapping and talks to the container
directly). Fix: map Docker to a non-default host port (this repo uses
`16379`).

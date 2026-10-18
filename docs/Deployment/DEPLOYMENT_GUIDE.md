# Deployment guide

Waypoint is deployed manually — there is no one-click hosting target baked into this repo.
`render.yaml`-style auto-deploy is intentionally not included; the deployer chooses a host
that runs a Next.js production server.

## Local development

See `TESTING.md` for the full, step-by-step runbook (it's written for both humans and AI
coding agents to follow literally). Short version:

```bash
bun install
cp .env.example .env
# FALKORDB_URL for local Docker (see below) — no account needed for this one
docker run -d --name falkordb -p 16379:6379 -p 3002:3000 \
  -v falkordb_data:/data falkordb/falkordb:latest
# FALKORDB_URL=falkor://localhost:16379
bun run dev
```

**Why Docker only for FalkorDB, locally.** The configured FalkorDB Cloud endpoint has been
unreachable (`ENOTFOUND`) since at least 2026-10-15 — see `IMPLEMENTATION_TRACKER.md`
M1.2. Until that's resolved, local development uses a Docker FalkorDB container; this is
the one sanctioned exception to "no Docker" (`AGENTS.md`). `bun run test:graph-acl` and
`bun run eval:compare` (in `graph_agent` mode) both exercise this container with real
`GRAPH.QUERY` calls, not mocks.

On Windows specifically, map the container to a **non-default host port** (`16379`, not
`6379`) — a native Windows Redis service often already listens on `6379`, and the Docker
port mapping silently connects to the wrong server (symptom: `ERR unknown command
'GRAPH.QUERY'` from the app, while `docker exec falkordb redis-cli GRAPH.QUERY ...` works
fine directly). Check with `netstat -ano | grep 6379` before assuming the port is free.

## Managed services for a real deployment

1. **Supabase** — create a project, set its site URL and email-confirmation redirect to
   `<app-origin>/auth/callback`, then apply every file in `supabase/migrations/` in
   filename order (see `docs/Database/DATABASE_DESIGN.md`).
2. **FalkorDB Cloud** — requires a TLS-enabled URL (`falkors://`, not `falkor://`) and an
   explicit graph name; the client in `src/lib/falkordb.ts` supports both schemes, but only
   `falkors://` is treated as cloud-reachable by `bun run diagnose:falkordb`.
3. **GitHub App** — register one with `Metadata`, `Contents`, `Issues`, `Pull requests`,
   `Checks` read permissions for source sync (add `Contents`/`Pull requests` write +
   `Commit statuses` read to enable draft-PR execution). Enable user authorization during
   installation. Set its callback to `<app-origin>/api/sources/github/callback`. Optional
   Dependabot alert import needs the App's Dependabot-alerts-read permission (GitHub marks
   this REST API public preview — expect it to change).
4. **Model provider** — any OpenAI-compatible `/chat/completions` endpoint. Groq's free
   tier (`openai/gpt-oss-20b`) is what this project was built against; switching providers
   is a three-env-var change (`readModelConfig()` in `agent-runner.ts` is fully
   provider-agnostic).

## Environment variables

| Variable | Required for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` | Everything (auth, workspaces, investigations, memory) |
| `FALKORDB_URL` | Graph queries, MCP tools, Ask/Investigate flows |
| `AI_BASE_URL`, `AI_API_KEY` (or `AI_API_KEYS`, comma-separated for the key pool), `AI_MODEL` | Agent runner, Ask, eval harness |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_STATE_SECRET` | GitHub source connector + draft-PR execution |

All of these are server-only secrets except the two `NEXT_PUBLIC_*` values, which must
also be present at build time if the host substitutes them then. Never put
`SUPABASE_SERVICE_ROLE_KEY` or any model/GitHub credential in a client bundle or a
`NEXT_PUBLIC_*` variable.

## Releasing

```bash
bun install --frozen-lockfile
bun run build
bun run start
```

- Point the host's liveness probe at `/api/health/live` — it's dependency-free and only
  confirms the app process responds. **It is not proof of cloud connectivity.**
  `/api/graph/health` (authenticated) reports FalkorDB + Supabase status and latency
  separately.
- Configure the host's scheduler to run `bun run worker:graph-projection` on a recurring
  cadence, with `SUPABASE_SERVICE_ROLE_KEY` and `FALKORDB_URL` available only to that
  trusted job — never alongside the web process's client-facing config. The worker uses a
  database lease, so running two copies concurrently is safe but wasteful; alert on a
  growing outbox queue depth or dead-lettered rows, both reported in its JSON output.

## Before calling anything "deployed and working"

Don't treat "the build succeeded" as "it works." `TESTING.md` §5 defines four levels —
code compiles, offline contract test passes, a real call against the live dependency
succeeds, end-to-end browser flow works — and only the last one should be shown to a
judge or a user as "working." `IMPLEMENTATION_TRACKER.md` records which level each
capability has actually reached, as of the last verification pass.

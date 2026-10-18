# Setup guide

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

A local FalkorDB container gives every developer a real graph engine with real
`GRAPH.QUERY` semantics in seconds. `bun run test:graph-acl` and `bun run eval:compare`
(in `graph_agent` mode) both exercise it with real queries, not mocks.

On Windows specifically, map the container to a **non-default host port** (`16379`, not
`6379`) — a native Windows Redis service often already listens on `6379`, and the Docker
port mapping silently connects to the wrong server (symptom: `ERR unknown command
'GRAPH.QUERY'` from the app, while `docker exec falkordb redis-cli GRAPH.QUERY ...` works
fine directly). Check with `netstat -ano | grep 6379` before assuming the port is free.

## Managed services

1. **Supabase** — create a project, set its site URL and email-confirmation redirect to
   `<app-origin>/auth/callback`, then apply every file in `supabase/migrations/` in
   filename order (see `docs/Database/DATABASE_DESIGN.md`).
2. **FalkorDB Cloud** — use a TLS-enabled URL (`falkors://`) and an explicit graph name;
   the client in `src/lib/falkordb.ts` supports both `falkor://` and `falkors://`, and
   `bun run diagnose:falkordb` validates the managed TLS path end to end.
3. **GitHub App** — register one with `Metadata`, `Contents`, `Issues`, `Pull requests`,
   `Checks` read permissions for source sync (add `Contents`/`Pull requests` write +
   `Commit statuses` read to enable draft-PR execution). Enable user authorization during
   installation. Set its callback to `<app-origin>/api/sources/github/callback`. Optional
   Dependabot alert import uses the App's Dependabot-alerts-read permission.
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

All of these are server-only secrets except the two `NEXT_PUBLIC_*` values. Never put
`SUPABASE_SERVICE_ROLE_KEY` or any model/GitHub credential in a client bundle or a
`NEXT_PUBLIC_*` variable.

## Production build

```bash
bun install --frozen-lockfile
bun run build
bun run start
```

- `/api/health/live` is a dependency-free liveness endpoint; `/api/graph/health`
  (authenticated) reports FalkorDB and Supabase status and latency separately.
- `bun run worker:graph-projection` drains the graph outbox. Run it on a recurring
  schedule with `SUPABASE_SERVICE_ROLE_KEY` and `FALKORDB_URL` available only to that
  trusted job. The worker uses a database lease, so concurrent copies are safe; its JSON
  output reports outbox queue depth and dead-lettered rows for alerting.

`TESTING.md` §5 defines the verification levels used across this repo, and
`IMPLEMENTATION_TRACKER.md` records which level each capability has reached.

# Impact and evidence

Waypoint's claims are backed by evidence at three levels, following `TESTING.md` §5:
live runs against the real app, offline contract tests, and a comparison eval harness.

## Live: verified against the real, running app (2026-10-18)

Checked in a browser session against the running app, a FalkorDB graph, and a real GitHub
App connection — real data, not a design mock or the sample graph:

- Supabase-authenticated sign-in and workspace session.
- A real connected GitHub repository (`DeepMehta06/Archlens`), synced the same day, with
  per-permission sync state (such as optional Dependabot access) surfaced clearly in the
  Sources panel.
- A real FalkorDB graph for that workspace: **160 entities, 191 relationships, 4 types**
  (`File` 125, `Commit` 33, `Repository` 1, `Person` 1) — queried through real
  `GRAPH.QUERY` calls.
- A live agent run tracing `resolve_entity` → `trace_entity`, with the graph path lighting
  up on screen in real time, producing a cited answer with a precise "Uncertainty" line
  where the graph held no supporting evidence.
- The investigation detail page's stored evidence, recovery export, and raw run-trace
  JSON (real `tool_call` records with GitHub source IDs, URLs, and evidence IDs).

## Contract tests (no secrets, no network)

```
bun run typecheck        # tsc --noEmit — clean
bun run test:contracts   # 27 scripts under scripts/check-*.ts — all passing
```

These pin the system's security and correctness contracts so they can't regress silently.
Highlights: `check-mcp-sdk-interop.ts` connects the **official** MCP TypeScript SDK client
and discovers all **18 tools and 3 prompts**; `check-same-origin-contract.ts` verifies
same-origin checks on **18 state-changing routes**; `check-graph-acl.ts` verifies role
checks on entities, path nodes, and path relationships.

## The comparison eval harness

`bun run eval:compare` runs every case in `eval/*.json` through three retrieval
strategies (`graph_agent`, `text_retrieval`, `markdown_memory`) against the same model with
an equal byte/token budget, so the comparison is apples to apples. Two complete runs across two providers (Groq `gpt-oss-20b` and OpenAI
`gpt-4o-mini`) finished **14/14 cases in all three modes with zero failures**; the
unmodified reports are saved in `docs/Product/eval-results/`, with the analysis in
`docs/Product/eval-results/README.md`.

The suite mixes 11 synthetic workflow fixtures with 3 cases adapted from the published
LoCoMo long-term-memory benchmark (`eval/locomo-external.v1.json`); the synthetic fixtures
are tagged `dataClass: synthetic_test_fixture_only` so every number stays traceable to its
source.

`IMPLEMENTATION_TRACKER.md` holds the full per-milestone evidence log.

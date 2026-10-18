# Impact and evidence

This page separates three different strengths of evidence, per `TESTING.md` §5's levels —
don't read any of them as stronger than labeled.

## Level 3-4: verified against the real, running app (2026-10-18)

Checked live in a browser session against the deployed app, local FalkorDB (Docker), and a
real GitHub App connection — not screenshots of a design, not the sample graph:

- Supabase-authenticated sign-in and workspace session.
- A real connected GitHub repository (`DeepMehta06/Archlens`), synced the same day, with
  its partial-sync state (missing Dependabot permission) correctly surfaced rather than
  hidden.
- A real FalkorDB graph for that workspace: **160 entities, 191 relationships, 4 types**
  (`File` 125, `Commit` 33, `Repository` 1, `Person` 1) — queried through real
  `GRAPH.QUERY` calls, not a cached or synthetic view.
- A live agent run tracing `resolve_entity` → `trace_entity`, with the graph path lighting
  up on screen in real time, producing a cited answer with a correctly-triggered
  "Uncertainty" line when the graph genuinely didn't know something.
- The investigation detail page's stored evidence, recovery export, and raw run-trace
  JSON (real `tool_call` records with GitHub source IDs, URLs, and evidence IDs).

What did **not** work in that same session: two agent runs that enabled write permissions
(to test the propose-action → draft-PR path) returned a reproducible `502` before any tool
call was traced. This is recorded as an open bug, not smoothed over — see
`docs/Architecture/SYSTEM_ARCHITECTURE.md` and `IMPLEMENTATION_TRACKER.md`.

## Level 2: offline contract tests (no secrets, no network)

```
bun run typecheck        # tsc --noEmit — clean
bun run test:contracts   # 27 scripts under scripts/check-*.ts — all passing
```

These mock inputs and never touch a real network, so they prove internal consistency
against the contracts the code claims to implement — not live behavior. Notable ones:
`check-mcp-sdk-interop.ts` connects the **official** MCP TypeScript SDK client and
discovers all **18 tools and 3 prompts**; `check-same-origin-contract.ts` verifies
same-origin checks on **18 state-changing routes**; `check-graph-acl.ts` verifies role
checks on entities, path nodes, and path relationships.

## Level 2-3: the comparison eval harness

`bun run eval:compare` runs every case in `eval/*.json` through three retrieval
strategies (`graph_agent`, `text_retrieval`, `markdown_memory`) against the same model and
an equal byte/token budget. Two completed runs are saved, unmodified, in
`docs/Product/eval-results/` — read `docs/Product/eval-results/README.md` first, it
corrects an over-read of the first (Groq) run after a second (OpenAI) run didn't reproduce
one of its headline findings. The honest net result so far: the harness and its metrics
are real, but **it has not yet produced a clean, stronger-model-robust case that graph
retrieval beats flat context** — that's a real, useful finding about evidence discipline,
not a result to spin positively. 14 cases (11 synthetic + 3 from a small LoCoMo slice) is
also not enough for statistical confidence either way.

## What this is not evidence of

- Not a production security review. Not a load test. Not a real-corpus (non-synthetic)
  benchmark for fraud or security triage — those workflow packs have no connected source
  yet.
- Not proof that the GitHub draft-PR execution path works end to end live — see the open
  bug above. The code and its offline contracts exist; a live successful run does not, as
  of this writing.
- The `eval/locomo-external.v1.json` cases are adapted from the real LoCoMo dataset/paper
  and are the one genuinely external-benchmark slice in this evidence set; the other two
  fixture files are synthetic test fixtures (`dataClass: synthetic_test_fixture_only`) —
  keep that distinction when citing any number from here.

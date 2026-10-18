# Backend guide

All server logic lives in `src/lib/` as plain TypeScript services, called from both REST
route handlers (`src/app/api/**/route.ts`) and the MCP dispatcher
(`src/lib/mcp-dispatch.ts`). There is no separate backend process other than the
Postgres-outbox worker.

## Module map

| Module | Responsibility |
|---|---|
| `graph-tools.ts` | `resolveGraphEntity`, `traceGraphEntity` — the only code paths that issue `GRAPH.QUERY`. ACL and scope clauses are built here and embedded in the Cypher, not applied after the fact. |
| `graph-agent-tools.ts` | `search_entities`, `graph_overview`, `find_experts`, `impact_analysis`, `shortest_path` — read-only derived graph views for the agent. |
| `agent-tools.ts` | `recallInvestigationFacts/Attempts/Tasks`, `proposeInvestigationAction`, `rememberCurrentFact`, task lifecycle, `explainInvestigation` — the MCP-facing wrappers around the durable stores below. |
| `agent-runner.ts` | The tool-selection loop (`runToolSelectionLoop`), system prompt, write-permission gating, citation validation, key-pooled model calls with retry/backoff. |
| `action-proposals.ts` | Proposal creation/review/execution — content hashing, approval binding, lease-protected execution. |
| `facts.ts` / `attempts.ts` / `tasks.ts` | Versioned current-fact writes, attempt/retry evidence rules, task claim/handoff/lease logic. |
| `run-traces.ts` / `run-trace-views.ts` / `run-trace-stream.ts` | Immutable event store for every run/tool-call, SSE streaming with resume. |
| `mcp-dispatch.ts` / `mcp-tools.ts` / `mcp-prompts.ts` / `mcp-protocol.ts` | MCP wire protocol: tool schemas, routing, discovery. |
| `github-app.ts` / `github-link.ts` / `github-patch.ts` / `github-source-import.ts` | GitHub App auth, installation binding, bounded metadata sync, draft-PR creation. |
| `graph-projection.ts` / `graph-projection-drain.ts` / `graph-projection-worker.ts` | The transactional-outbox consumer (`worker:graph-projection`). |
| `key-pool.ts` | Rotates across multiple model API keys, cools down rate-limited keys, retires rejected ones. |
| `workspace-supabase.ts` / `workspace.ts` | Resolve the authenticated caller's workspace + role on every request. |
| `same-origin.ts` / `read-json-body.ts` | Cross-cutting request hardening (see `docs/API/API_REFERENCE.md`). |

## The agent loop, invariant by invariant

`runToolSelectionLoop` (`agent-runner.ts`) is a bounded loop: at most `MAX_AGENT_TOOL_CALLS`
(4) tool calls, each tool result capped at `MAX_AGENT_TOOL_RESULT_BYTES` (16KB). On every
iteration:

1. The model is given only the tools explicitly selected for this run
   (`selectAgentToolNames`) — read tools are always available; write tools
   (`propose_action`, `remember_fact`, `create_task`, …) are added **only** if the caller's
   `requestedWrites` permission is set *and* the question text matches an explicit-intent
   regex for that action (e.g. `propose_action` needs `/\b(propose|create|draft|prepare|open)\b.{0,80}\b(action|proposal|pull request|pr|patch|fix|rollback|remediation)\b/i`,
   and negated/"how do I" framings are excluded).
2. Every tool call's `investigationId` argument is checked against the real one — a model
   trying to reach across investigations throws immediately.
3. A citation (source ID + version) used in `propose_action` or `remember_fact` must
   already appear in `observedEvidence` — evidence actually returned by an earlier
   successful tool call in *this* run. Citing anything else returns a structured rejection,
   not a crash.
4. `propose_action` additionally requires a successful `recall_attempts` call first, and —
   for every attempt that previously failed with a matching key — a structured
   `applicability` + `explanation` + evidence-backed `changedConditions` entry
   (`validatePriorAttemptReview`, `attempt-review.ts`).
5. The final model response must be one JSON object:
   `{abstained, claims[], alternatives[], uncertainty}` — every claim's citations are
   checked against `observedEvidence` again before being shown; an unsupported or
   malformed citation forces `abstained: true`, not a best-effort answer.

## Model calls: retry, rate limits, multi-key

`completeWithModel` pools 1+ API keys (`key-pool.ts`) and:

- Skips retrying a request the provider explicitly marked `x-should-retry: false`.
- Caps any provider-suggested retry wait at 20 seconds, regardless of a larger
  `retry-after` header — a free-tier provider returning "retry in 6 minutes" should fail
  fast and let the caller decide, not block the request.
- Sends `tool_choice: "none"` (not `tools: []` + `tool_choice: "auto"`) on the
  forced-final-answer turn, because some providers (Groq) reject that combination
  outright; a model that still attempts a tool call under `"none"` is converted to a
  graceful abstention (`isToolUseFailedWithNoToolsOffered`) instead of a crash.

These three are documented gotchas in `TESTING.md` §6 — they were each found by actually
running the loop against a live model, not by code review, and are flagged there so they
don't get silently reintroduced.

## Action proposals: the write path in detail

`action-proposals.ts` enforces, independent of what the agent runner already checked:

- Every cited source ID/version is re-validated against the workspace's accessible
  source-version registry at the **database boundary** (migration 019), so a direct
  REST/MCP caller can't bypass the agent runner's citation check.
- A `github_patch` proposal's target must include `repository`, `ref` (base branch), and a
  40-character `baseSha` — all three from authorized source evidence, never guessed.
- Approval stores an immutable, row-locked decision bound to the proposal's exact content
  hash; changing the target, inputs, or evidence after approval invalidates it.
- Execution claims a 10-minute database lease (prevents two concurrent executions of the
  same proposal), re-checks approval + hash + evidence freshness + pinned base SHA, then
  requests a token scoped to **one repository** with only `contents:write`,
  `pull_requests:write`, `checks:read`, `statuses:read` — revoked immediately after the
  request completes, win or lose.
- The service re-reads the resulting PR from GitHub and requires an exact expected
  head/base/commit before reporting anything as observed — "success" means "the PR is
  confirmed to exist in the expected state," never "the model said it worked."

## Rollback proposals

`deployment_rollback` proposals share the same durable storage, content hash, and
immutable owner/admin approval as every other proposal type.

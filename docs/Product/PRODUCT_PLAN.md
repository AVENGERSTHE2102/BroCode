# Product plan

**Waypoint is an action-first agent for connected operational data.** One graph/MCP/memory
engine is built around three workflow packs: codebase work, fraud investigation, and
security triage. The engine connects source records to related entities, preserves
provenance and access controls, and lets an agent propose a bounded next action with an
explanation. Every action requires human approval of the exact proposal.

| Product capability | Hackathon track | User result |
|---|---|---|
| **Actions** — primary | T1 Agents That Act on Connected Data | Select graph/MCP tools, investigate relationships, propose actions, and approve the exact change before it runs. |
| **Brain** — supporting | T3 Company Brain | Connect source-controlled engineering and operational records with inspectable provenance and paths. |
| **Memory** — supporting | T2 Agent Memory and Coordination | Preserve prior attempts, current facts, task ownership, and acknowledged handoffs across sessions. |

The three domain packs share one graph/MCP/authorization/memory core — they are not three
separate products built side by side. The **codebase work** pack runs on a live GitHub
connection.

## Pain points this targets, and what counts as proof

Kept here as the acceptance contract — these IDs should stay attached to any regression
scenario or demo step that claims to address them.

| ID | Pain | Required proof |
|---|---|---|
| P1 | Cross-session continuity disappears between sessions | A new session recovers the current task and relevant prior attempts without replaying the whole conversation. |
| P2 | Unclear current truth — old and new facts coexist | Current recall returns the accepted fact; history preserves prior facts; conflicts enter review. |
| P3 | Agent coordination — duplicate work, lost updates | Concurrent task claims have exactly one owner; handoffs require acknowledgement; restart preserves state. |
| P4 | Memory privacy and poisoning | Tenant boundaries hold everywhere; external content can't grant access or forge approval. |
| P5 | Fragmented, stale knowledge across sources | A multi-source answer shows source version and freshness; partial imports stay visible. |
| P6 | Missing decision rationale | Decisions record evidence, rationale, approver, outcome; missing rationale is reported, not hidden. |
| P7 | Incomplete multi-hop answers from similarity search alone | Bounded graph traversal assembles a sourced path; a missing link is an explicit gap, not a guess. |
| P8 | Entity identity errors (merged or split identities) | Exact IDs and explicit aliases resolve; ambiguous names stay separate until reviewed. |
| P9 | Opaque context, confusing tool surface | A run view shows selected sources, tool calls, and truncation; the MCP surface stays small and unambiguous. |
| P10 | Memory clutter and ineffective deletion | Retrieval is bounded and current by default; explicit forgetting removes content from derived/live records before reporting done. |

## User journey

1. Authenticate and resolve workspace membership server-side.
2. Connect explicitly selected read-only sources (GitHub, through a least-privilege App).
3. Import revisions with provenance; expose partial failures, preserve prior valid data.
4. Investigate with MCP-selected graph queries across relevant entities, owners,
   decisions, and previous attempts.
5. See evidence paths, source versions, and uncertainty; abstain when evidence is missing.
6. Propose a change; bind human approval to exact inputs and evidence versions.
7. Execute idempotently under a lease, verify the provider's observed result, persist the
   outcome.
8. Restart the session and recover the investigation and outcome, subject to current
   access and deletion rules.

See `docs/Product/IMPACT_AND_EVIDENCE.md` for the live verification record.

## Stack

| Area | Decision |
|---|---|
| Web | Next.js, TypeScript, Tailwind, shadcn/ui, a dependency-free SVG graph renderer. |
| API, agent, MCP | TypeScript services inside the Next.js app; official MCP TypeScript SDK. |
| Identity + control plane | Supabase Auth + Postgres, RLS-enforced. |
| Context graph | FalkorDB, one graph per workspace, server-derived graph names. |
| Durable workflow state | Supabase Postgres with a transactional outbox into the graph. |
| Background work | A scheduled Bun worker drains the outbox in bounded batches. |
| LLM | Any OpenAI-compatible `/chat/completions` provider — built against Groq's free tier. |

## Scope

This submission centers on the core engine and the GitHub-backed codebase workflow, with
the shared graph, MCP, authorization, and memory layers built for every pack.

## Research basis

The product's pain-point list above was compiled from a source archive of ten identified
pain points, drawn from organizer requirements, firsthand reports, research papers, and
industry writing, with every source link audited in
`docs/Product/ResearchArchive/research-verification.md`. Full research notes are
preserved in `docs/Product/ResearchArchive/part1.md` through `part4.md`, so any claim
can be traced back to its source.

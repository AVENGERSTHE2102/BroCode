# Architecture decisions

Short-form decision records — the "why," not the "what" (the what is in
`docs/Architecture/SYSTEM_ARCHITECTURE.md`). Each one is still in force unless a later
entry says otherwise.

## D1 — One shared core across three workflow packs, not three products

Fraud investigation, security triage, and codebase work all run on the same graph, MCP
surface, authorization model, memory store, and audit trail. They are domain-specific
*evidence guidance and prompt framing* on top of one engine, not three separately built
products that happen to share a repo.

**Why:** the hackathon's own pain-point research (P1–P10) applies identically across all
three domains — cross-session continuity, identity resolution, memory poisoning, and
multi-hop traversal aren't fraud-specific or codebase-specific problems. Building three
separate engines would triple the surface needing the same trust guarantees.

**Consequence:** a new domain pack needs a source adapter and prompt guidance, not a new
authorization/memory/audit implementation.

## D2 — Postgres is authoritative; FalkorDB is a projection

Supabase Postgres owns every mutable workflow fact (investigations, current facts, task
leases, approvals, audit events). FalkorDB never receives a direct write from a request —
only from the transactional-outbox worker.

**Why:** Postgres gives RLS, real transactions, and `409`-on-stale-write semantics for
free; a graph database optimized for traversal reads is a worse fit for "did this
concurrent write actually win." Keeping one system authoritative also means the graph can
always be rebuilt by replaying the outbox — there's no scenario where the two stores
disagree about what actually happened.

**Consequence:** every workflow write has a few hundred milliseconds of projection lag
before it's traversable in the graph; the UI treats "queued for projection" as a visible
state, not a hidden one.

## D3 — Actions require human approval bound to an exact content hash

An agent can call `propose_action`, never execute one. Approval is an immutable row bound
to a SHA-256 hash of the exact proposal content; any change to the target, inputs, or
cited evidence invalidates that approval.

**Why:** "the agent proposed X and a human clicked approve" is a weak guarantee if X can
silently drift between proposal and execution (stale evidence, a moved base branch, a
model that re-generates a diff). Binding approval to a hash of the literal content makes
"approved" mean "approved this exact thing," full stop.

**Consequence:** any legitimate change to a proposal (new evidence, a different diff)
requires a fresh approval — there is no "update in place and keep the old approval" path,
by design.

## D4 — Local development runs FalkorDB in Docker

Managed cloud services are the default for every shared environment. For local
development, FalkorDB runs in a Docker container (`AGENTS.md`, `TESTING.md` §2.2).

**Why:** a local container gives every developer a real FalkorDB engine with real
`GRAPH.QUERY` semantics in seconds — no shared state, no network dependency, and the same
query paths the app uses against a managed instance. Synthetic/local-only results are kept
distinct from cloud-integration evidence; see `docs/Product/IMPACT_AND_EVIDENCE.md`.

**Consequence:** `bun run diagnose:falkordb` stays intentionally cloud-TLS-specific
(`falkors://`), so it always validates the managed-service path rather than the local
container.

## D5 — Agent-submitted memory is quarantined, not trusted

`remember_fact` writes a candidate, excluded from current facts, graph projection, and
future run evidence until an owner/admin explicitly approves it.

**Why:** letting a model's own output become trusted memory without review is exactly the
P4 memory-poisoning pain point this project is meant to address — an agent that reads
attacker-controlled source content must not be able to write that content into its own
future "facts."

**Consequence:** every `remember_fact` call needs a human review step before it affects
any later answer — there is no fast path, even for an owner's own agent session.

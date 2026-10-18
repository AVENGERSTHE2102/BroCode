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

## D4 — Local FalkorDB via Docker is a sanctioned exception to "no Docker"

`AGENTS.md` says cloud databases and services only, no Docker. Local development uses a
Docker FalkorDB container anyway.

**Why:** the configured FalkorDB Cloud endpoint has been unreachable (`ENOTFOUND`) since
2026-10-15 (`IMPLEMENTATION_TRACKER.md` M1.2) — without a local fallback, no one could
exercise a real `GRAPH.QUERY` path at all during this build window. Docker here is a
development-environment workaround for a specific, dated, external outage — not a
reversal of the deployment constraint. Synthetic/local-only results from it don't count as
cloud-integration acceptance evidence; see `docs/Product/IMPACT_AND_EVIDENCE.md` for how
that distinction is actually applied.

**Consequence:** don't "fix" `bun run diagnose:falkordb` to accept a local `falkor://`
URL — it's intentionally cloud-TLS-specific, so it keeps testing the thing that's actually
broken (see `TESTING.md` §2.2).

## D5 — Agent-submitted memory is quarantined, not trusted

`remember_fact` writes a candidate, excluded from current facts, graph projection, and
future run evidence until an owner/admin explicitly approves it.

**Why:** letting a model's own output become trusted memory without review is exactly the
P4 memory-poisoning pain point this project is meant to address — an agent that reads
attacker-controlled source content must not be able to write that content into its own
future "facts."

**Consequence:** every `remember_fact` call needs a human review step before it affects
any later answer — there is no fast path, even for an owner's own agent session.

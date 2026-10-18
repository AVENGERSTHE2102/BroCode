# Waypoint — Master Specification

**The context layer for AI agents: shared memory, company knowledge, and accountable action, on one graph.**

| | |
|---|---|
| **Document** | Product, validation and technical specification (build-ready) |
| **Version** | 0.1 (draft for build) |
| **Date** | 15 October 2026 |
| **Target event** | Graph Hacks: Context for AI Agents (WeMakeDevs × FalkorDB), 15–18 Oct 2026, online |
| **Submission deadline** | 18 Oct 2026, 11:59 PM IST (plan to submit by 8 PM IST; see §17) |
| **Tracks entered** | T1 Agents That Act on Connected Data, T2 Agent Memory and Coordination, T3 Company Brain |
| **Working name** | Waypoint (rename freely; nothing below depends on it) |
| **Primary datastore** | FalkorDB (one graph per tenant) |

> **How to read this document.** Sections 1–6 explain *what* and *why* (problem, proof, solution, why it beats alternatives). Sections 7–13 are the build documentation (architecture, data model, Cypher, agent layer, security, SaaS operations, API). Sections 14–18 are the delivery plan (UX, evaluation, testing, schedule, demo and submission). Section 19–20 cover business and decisions. Appendices hold the full source library and traceability matrix.

> **Evidence discipline.** Every claim about the outside world carries an evidence tag (§4.1). Anything tagged *proposal* is our reasoning, not established fact. Numbers from vendors or unread sources are never used as proof.

## Contents

1. [Executive summary](#1-executive-summary)
2. [Hackathon brief, rules and compliance](#2-hackathon-brief-rules-and-compliance)
3. [The problem](#3-the-problem)
4. [Validation evidence](#4-validation-evidence)
5. [The solution](#5-the-solution)
6. [Why this is the best approach](#6-why-this-is-the-best-approach)
7. [System architecture](#7-system-architecture)
8. [Data architecture](#8-data-architecture)
9. [Cypher query catalog](#9-cypher-query-catalog)
10. [Agent, memory and MCP layer](#10-agent-memory-and-mcp-layer)
11. [Security, privacy and safety](#11-security-privacy-and-safety)
12. [SaaS platform: tenancy, billing, operations](#12-saas-platform-tenancy-billing-operations)
13. [API reference](#13-api-reference)
14. [Console UX specification](#14-console-ux-specification)
15. [Evaluation and benchmarks](#15-evaluation-and-benchmarks)
16. [Testing and quality](#16-testing-and-quality)
17. [Build plan](#17-build-plan)
18. [Demo, submission and blog](#18-demo-submission-and-blog)
19. [Business: market, pricing, go-to-market, roadmap](#19-business-market-pricing-go-to-market-roadmap)
20. [Architecture decision records](#20-architecture-decision-records)
- [Appendix A: Source library (54 records)](#appendix-a-source-library)
- [Appendix B: Traceability matrix](#appendix-b-traceability-matrix)
- [Appendix C: Seed dataset specification](#appendix-c-seed-dataset-specification)
- [Appendix D: Glossary](#appendix-d-glossary)
- [Appendix E: Assumptions and open questions](#appendix-e-assumptions-and-open-questions)

---

## 1. Executive summary

### 1.1 One-line pitch

**Waypoint gives every AI agent in a company a shared, permissioned, time-aware memory, and makes every answer and every action traceable to a path in a graph.**

### 1.2 The problem in three sentences

Agents lose what they learned between sessions, cannot tell which of two conflicting facts is current, and cannot show why they answered or acted the way they did. Company knowledge sits in disconnected tickets, documents, chats and code, so questions that depend on *how things relate* get fragments instead of answers. When several agents or tenants share a memory, nothing reliably stops stale overwrites, duplicated actions, cross-tenant leaks or poisoned memories.

### 1.3 The solution in three modules and one loop

| Module | Track | What the customer gets |
|---|---|---|
| **Brain** | T3 Company Brain | Connect sources; get an entity-resolved graph of people, teams, services, tickets, documents and decisions. Ask "why was X delayed and who can unblock it?" and receive an answer with a clickable evidence path, or an honest "not documented". |
| **Memory** | T2 Agent Memory and Coordination | An MCP memory service with episodic, semantic and procedural memory; bitemporal facts that supersede instead of overwrite; versioned tasks and acknowledged handoffs; per-tenant isolation; quarantine for untrusted writes; deletion that propagates. |
| **Actions** | T1 Agents That Act on Connected Data | An incident-response agent that traverses dependencies, ownership and recent changes, proposes a remediation, waits for human approval, executes in a sandbox, and records the full trace. |

**The loop that makes it one product:** every approved action is written back as a *Decision* with evidence (feeds Brain) and as *episodic and procedural memory* (feeds Memory). The next agent starts from a better graph than the last one did.

### 1.4 Why a graph is load-bearing here (not decoration)

Hackathon rule 3 says that if the product still works with FalkorDB removed, the graph is decoration. In Waypoint, FalkorDB holds the *only* copy of: entity identity, fact versions and supersession chains, task state and leases, handoff acknowledgements, authorization scopes, provenance edges and action traces. Every agent tool is a Cypher traversal or algorithm. Remove the graph and there is nothing left to run. The benchmark harness (§15) compares against a vector-only baseline as a *separate evaluation tool*, not as a product fallback.

### 1.5 What is new versus what exists

Memory libraries, GraphRAG SDKs and enterprise search already exist. Waypoint's contribution is the combination and the discipline around it:

1. **One graph for three jobs** (knowledge, memory, action) so each feeds the others.
2. **Deterministic currency rules** (predicate cardinality plus time) instead of an LLM deciding which fact wins. A public test in the Mem0 discussion found an LLM judge labelled both planted supersession pairs as contradictions (§4.3).
3. **Evidence-or-abstain answers**: every claim cites a graph path; missing rationale yields "unknown" instead of invented reasons.
4. **A built-in ablation scoreboard** (graph on/off, temporal off, ACL off, tool count) so judges can see what the graph buys.
5. **Governance by construction**: graph-per-tenant isolation, per-hop authorization, mandatory provenance constraints, quarantine of untrusted memory, approval-gated actions.

### 1.5.1 What we will and will not claim

| We will claim | We will not claim |
|---|---|
| Our measured results on our own benchmark, with baselines, failure cases and ablations | That graphs always beat text retrieval |
| That deterministic supersession avoids a documented LLM-judge failure mode | That the 88% pilot-failure or any unverified percentage is established |
| That tenant isolation holds against our N attack scripts | That the system is production-secure or compliance-certified |
| That the design is aligned with the organisers' stated problem | That any competitor "lacks" a capability (we have not audited them) |

### 1.6 Scope for the hackathon (P0 only)

One seeded fictional company plus one public GitHub repository; seven MCP tools; Brain Q&A with evidence paths; memory with supersession, optimistic concurrency, handoffs, quarantine and tenant isolation; incident agent with approval gate and sandbox execution; a web console with graph canvas; a benchmark page with graph on/off toggles; deployment (or local setup plus video); README, queries and data model as required by rule 10.

---

## 2. Hackathon brief, rules and compliance

*Checked against the official pages on 15 Oct 2026: `https://www.wemakedevs.org/hackathons/falkordb` and `/rules`. Rules may be amended through WeMakeDevs and FalkorDB channels; re-check the Rules page and Discord before submitting.*

### 2.1 The brief (paraphrased)

Build a working agent, or group of agents, with FalkorDB as the context layer. The graph must shape what the agent does. The organisers describe the problem as agents seeing pieces instead of the whole picture, losing track of earlier sessions, missing how people, systems and records relate, and being unable to explain choices. They list five things the graph should do: follow connections across data, remember across sessions, share state between agents, connect people, projects and decisions, and show the path behind an answer.

### 2.2 Tracks and what each one asks for

| Track | Prize | Organisers' key focus | Waypoint module |
|---|---|---|---|
| **T1** Agents That Act on Connected Data | iPhone 18 Pro | Multi-hop reasoning; graph queries and algorithms as agent tools; tool selection through MCP; actions based on what the graph shows; explainable results | Actions (incident responder) |
| **T2** Agent Memory and Coordination | PS5 with GTA VI | Episodic, semantic and procedural memory; persistent conversation history; shared state and handoffs; high-concurrency reads and writes; separate memory per user or tenant | Memory |
| **T3** Company Brain | M6 Mac Mini | Knowledge from docs, tickets and chats in one graph; who owns what and who knows what; tracing decisions to source; keeping knowledge current; answers with clear sources | Brain |

Side prizes: **Best blog post** (AirPods 5, one winner) and **Top 50 submissions** (T-shirt for every member of the top 50 teams). Prize pool $20,000; every member of a winning team receives the prize.

### 2.3 Rules and how we comply

| # | Rule (paraphrased) | How Waypoint complies | Proof artifact |
|---|---|---|---|
| 1 | Solo or team of up to 4; one team per participant | Decide team size before registering; one registration | Registration page |
| 2 | FalkorDB is the primary graph database and supports a central part of the product | FalkorDB holds identity, memory, tasks, authz, provenance, traces | §8, §9 |
| 3 | The graph does real work; if the product works without FalkorDB the graph is decoration | Every tool is a Cypher query or algorithm; no secondary store holds the same data | §1.4, ablation in §15 |
| 4 | Docker, self-hosted, or FalkorDB Cloud all accepted | Docker Compose locally; FalkorDB Cloud or self-hosted container for demo | §7.6, §17 |
| 5 | Name every track entered at submission | Select **T1, T2 and T3** explicitly in the submission form | Submission checklist §18.4 |
| 6 | Data must be public, synthetic or your own; no private, login-protected, paywalled or personal data | Synthetic fictional company ("Northwind Payments") plus one public GitHub repo; no real Slack/Jira tenants | Appendix C |
| 7 | Event window 15 Oct 12:01 AM IST to 18 Oct 11:59 PM IST | Schedule in §17 freezes code Sunday afternoon | §17.5 |
| 8 | Main coding and design starts after the event begins; notes, sketches and diagrams beforehand are fine | This spec is notes and diagrams; code starts now | — |
| 9 | Libraries, public APIs, templates and public datasets allowed; original work during the event is judged | Use FastAPI, MCP SDK, FalkorDB client, Next.js; the schema, tools, memory manager, ACL layer and eval harness are new work | Repo history |
| 10 | Submission must include: public repo; README with setup and graph data model; the Cypher queries or algorithms the product depends on; demo video; live deployment or complete local setup; the track(s) | Repo layout in §17.2; README skeleton in §18.3; query catalog in §9 mirrored to `docs/queries.md` | §18.4 checklist |
| 11 | AI coding assistants allowed but must be disclosed | Disclosure section in README (template §18.3) | README |
| 12 | Participants must understand and be able to explain the graph model, queries, architecture and decisions | ADRs in §20 and the judge Q&A in §18.5 are the study guide | §20 |
| 13 | Projects entirely AI-generated without meaningful contribution or understanding may be rejected | Team writes and reviews all Cypher; keep commit history human-attributed; record design decisions | ADR log |
| 14 | One prize per track; winners' team members all receive it | Entering all three tracks competes for all three prizes | §2.2 |
| 15 | IP belongs to the participant or team; agree internally before submitting | If team >1, agree on ownership in writing | — |
| 16–18 | Respect, no plagiarism, no manipulation of judging; violations lead to disqualification | Cite any reused code; no fabricated metrics in the pitch | §1.5.1 |

> **Not published on the pages we checked:** a formal judging rubric, a maximum video length, and the exact submission form fields. Treat §18 as a best-effort plan and confirm these in the submission panel and on Discord.

---

## 3. The problem

### 3.1 Problem statement

> AI agents operate on **flat, forgetful and unaccountable context**. Flat: related facts live in separate records, so connected questions get fragments. Forgetful: what an agent learned does not reliably survive sessions, compaction or handoffs, and old facts are not reliably retired when they change. Unaccountable: when an agent answers or acts, nobody can see the evidence path, who authorised it, or whether it was allowed to read the inputs.

### 3.2 Six root problems

| ID | Root problem | Pain points it contains | Tracks |
|---|---|---|---|
| RP1 | **Forgetting**: state does not survive sessions and context compression, and unbounded memory becomes noise | B.1.1, B.1.10 | T2 |
| RP2 | **No notion of "current truth"**: contradictions and superseded facts coexist with no deterministic answer about which governs now | B.1.2 | T2, T3 |
| RP3 | **Fragmented organisational context**: ownership, decisions and history are scattered; the same person or service appears under many names | B.1.5, B.1.6, B.1.8 | T3, T1 |
| RP4 | **Shallow retrieval for connected questions**: nearest-neighbour text does not guarantee connected evidence | B.1.7 | T1, T3 |
| RP5 | **Uncoordinated and unsafe multi-agent operation**: stale reads, lost updates, duplicate actions, tenant leakage, poisoned memory | B.1.3, B.1.4 | T2 |
| RP6 | **Unaccountable action**: too many loosely defined tools, no argument audit, no evidence trail for side effects | B.1.9, B.1.6 | T1 |

### 3.3 Problem cards

Each card states the problem, a concrete scenario, why common approaches fall short, what "solved" means, and the caveat. Evidence IDs (D.xx) refer to Appendix A.

#### P1 — Cross-session amnesia (B.1.1) · T2

- **Problem.** An agent loses implementation facts, preferences, previous attempts and unfinished plans after a session ends or the context is compacted. Users repeat setup; agents revisit rejected approaches.
- **Scenario.** Monday: the agent and a developer reject Redis for rate limiting because of a licensing constraint. Wednesday, a fresh session proposes Redis again.
- **Why current approaches fall short.** Chat history is ordered text, not structured state; summaries drop detail; per-tool memory files do not travel across devices or agents.
- **Solved means.** After restart, exact facts, constraints and open tasks are recalled with source, at lower token cost than replaying history.
- **Evidence.** Firsthand but narrow: D.02 (cross-device continuity friction, closed as not planned). Explainers: D.31, D.35, D.30, D.32. Strength: **moderate-weak**; we generate our own evidence in §15.
- **Caveat.** Confusing conversation history with durable state; storing everything wastes tokens and lets stale content dominate.

#### P2 — Contradictions and superseded memories (B.1.2) · T2/T3

- **Problem.** Preferences, owners, status and roles change. Append-only memories keep both old and new, with no deterministic answer for "which governs now".
- **Scenario.** Session 1: "I prefer Python." Session 3: "I mostly use TypeScript now." Recall returns both.
- **Why current approaches fall short.** In the Mem0 discussion contributors' description of the additive path is that both memories are kept and linked; commenters note linking is not resolution (D.01).
- **Solved means.** Current-state queries return exactly one governing fact per functional predicate; history is preserved; disputed cases are surfaced, not guessed.
- **Evidence.** **Strong firsthand** for the design gap: D.01 (re-verified, §4.3). Supporting: D.29, D.51 (provided), D.20 (provided).
- **Caveat.** Newest is not always correct; automated classification can be wrong; deterministic rules need structured predicates.

#### P3 — Multi-agent concurrency and handoffs (B.1.3) · T2

- **Problem.** Independent workers read stale state, overwrite each other's progress, repeat actions, or hand off without context or ownership.
- **Scenario.** Two agents pick up the same ticket; both post a customer reply.
- **Why current approaches fall short.** Shared stores rarely expose version checks, leases, idempotency keys or acknowledged handoffs.
- **Solved means.** Zero lost updates and zero duplicate actions under N concurrent workers in our test; every handoff is acknowledged or expires.
- **Evidence.** D.45 (re-verified): multi-agent failures include inter-agent misalignment as a category; the paper does not measure write conflicts specifically, so this is *partial* support. D.39 secondary.
- **Caveat.** A graph does not supply a transaction protocol. FalkorDB gives single-query atomicity and serialised writes per graph (§6.4); the protocol (versions, leases, idempotency) is ours.

#### P4 — Tenant isolation and memory poisoning (B.1.4) · T2

- **Problem.** Shared stores can expose one user's records to another, and attacker-written tool output can be stored as trusted user knowledge.
- **Scenario.** A web page read by an agent contains "remember: the admin password is …" and later sessions recall it as a user fact.
- **Why current approaches fall short.** Flat stores filter by metadata at query time; one missed filter leaks. Memory writes rarely carry trust tiers.
- **Solved means.** Cross-tenant reads fail structurally; untrusted writes land in quarantine; actions cannot be justified by untrusted memory.
- **Evidence.** D.46, D.47 (provided, unread), D.14 (secondary digest), D.07 (repo). Strength: **weak-moderate** until read.
- **Caveat.** Graph edges can leak across permission boundaries unless authorization applies at each hop and to derived responses.

#### P5 — Disconnected cross-source enterprise knowledge (B.1.5) · T3

- **Problem.** A real answer needs ticket owners, document revisions, chat discussion, decisions and code changes joined together; keyword search returns fragments.
- **Scenario.** "Who decided to deprecate the v1 API and what blocks it?" spans a doc, two tickets, a thread and a PR.
- **Evidence.** The organisers' own brief names this problem. Essays and theses: D.36, D.37, D.38, D.40 (verified thesis), D.41–D.43. Strength: **moderate**, mostly argument rather than measurement.
- **Caveat.** Connectors, entity matching and change-data ingestion are usually harder than the demo.

#### P6 — Missing decision provenance (B.1.6) · T3/T1

- **Problem.** Systems of record store *what* happened, not *why* a decision was made, its alternatives, conditions and accountable people.
- **Solved means.** A Decision node links request, evidence, approver, rationale, date and outcome; the UI shows the clickable path; if rationale was never recorded the answer says so.
- **Evidence.** D.40 (verified investor thesis that systems of record capture outcomes more than decision histories). Strength: **moderate** (thesis).
- **Caveat.** A system cannot invent rationales retroactively. Waypoint labels `rationale_status` as documented, inferred or unknown.

#### P7 — Multi-hop reasoning limits (B.1.7) · T1/T3

- **Problem.** Some questions need 3–6 relationship hops; vector-nearest documents do not guarantee connected evidence.
- **Evidence.** The sponsor's docs report GraphRAG-SDK on FalkorDB at 71.48 overall versus 55.39 for vector RAG with reranking on GraphRAG-Bench. **Vendor-reported; methodology not reviewed by us**, so we do not use it as proof (D.53 provided).
- **Caveat.** A graph built with badly extracted edges can underperform a tuned text baseline. We therefore ship the baseline and the ablation (§15).

#### P8 — Entity identity collisions (B.1.8) · T1/T3

- **Problem.** The same person, project or service appears under many aliases; different entities share a name. Both corrupt graph queries.
- **Scenario.** "Priya S." in Slack, "priya.sharma" in Git, and two different Priya Sharmas in different teams.
- **Evidence.** Weak in our archive. Related signal: GraphRAG SDK documents an entity-deduplication step. Strength: **weak-moderate; justified by design necessity**.
- **Caveat.** High-recall matching merges different entities; merges must be explainable, reversible and confidence-banded.

#### P9 — Tool overload and action explainability (B.1.9) · T1

- **Problem.** Many loosely defined tools raise selection and execution error; users cannot tell which evidence triggered an action.
- **Evidence.** D.34 (percentages unverified), D.11. Strength: **weak**. We treat "seven tools beat twenty-five" as a hypothesis and test it in §15.
- **Caveat.** Fewer tools is not proof of better outcomes.

#### P10 — Forgetting, retention and deletion (B.1.10) · T2/T3

- **Problem.** Unbounded memory raises cost, hides relevant facts, and can retain information beyond policy or user intent.
- **Evidence.** D.29 (verified explainer on selective forgetting), D.22 (provided). Strength: **moderate-weak**.
- **Caveat.** Auditability and deletion conflict; define retention basis and tombstone design (§10.6).

### 3.4 Who has the problem

| Persona | Pain | Buys because |
|---|---|---|
| **Agent platform engineer** | Memory that silently drifts, agents that collide, no audit trail | Needs a drop-in MCP context layer with isolation and evidence |
| **Engineering manager / staff engineer** | Cannot answer "why" and "who" questions across tools | Wants a company brain with sources |
| **SRE / on-call lead** | Incident triage re-discovers the same context each time | Wants an agent that follows dependencies and proposes safe, approvable fixes |
| **Security / compliance owner** | Prompt injection, cross-tenant leakage, deletion requests | Needs provenance, quarantine, ACLs, auditable deletion |
| **Workspace admin (SaaS)** | Onboarding, seats, billing, quotas | Needs a normal SaaS console |

### 3.5 Why now

Agents are moving from demos to long-running, multi-agent, tool-using deployments (market context: D.28 announcement of Stack Overflow for Agents, verified in the archive; D.44 reports a forecast that many agentic projects may be cancelled by 2027, which is a *prediction*, not an observed outcome). MCP gives a common tool interface, so a context layer can serve any agent without per-framework integration.


# Waypoint — build plan

**Waypoint is a shared context service for engineering agents.** It connects company knowledge, durable agent memory, and approved actions in one FalkorDB graph per workspace. A human can inspect the evidence and state behind each answer and action.

## Product promise

An agent investigating a checkout incident finds the affected services, owners, recent deployments, relevant decisions, previous attempts, and runbooks. It hands findings to a responder, proposes a sandbox rollback with evidence, and waits for human approval. The outcome and any learned procedure become available to the next session, subject to workspace permissions and deletion requests.

| Product capability | Hackathon track | User result |
|---|---|---|
| Brain | T3 Company Brain | Ask questions over connected company records and inspect the source path. |
| Memory | T2 Agent Memory and Coordination | Continue work across sessions, update facts safely, and hand tasks between agents. |
| Actions | T1 Agents That Act on Connected Data | Investigate connected evidence, propose a sandbox action, and record its approval and outcome. |

The official challenge allows entrants to target all three tracks. FalkorDB must be central to the product. The graph stores relationships, memory versions, tasks, approvals, and traces used by the application; it is not a display-only copy.

## Research rule

The source archive identifies ten pain points. Their strength varies: organizer requirements establish contest fit; firsthand reports establish particular user experiences; research papers establish results within their stated experiments; vendor and opinion pieces provide hypotheses. None of these sources alone establishes customer demand for Waypoint. The link audit and source notes are in [docs/research-verification.md](docs/research-verification.md).

## Pain points and acceptance criteria

Keep these IDs in development tasks, demo steps, and regression scenarios.

| ID | Pain to address | Required behavior and proof |
|---|---|---|
| P1 | **Cross-session continuity:** context, constraints, previous attempts, and unfinished work disappear between sessions. | A new session recovers the current task and relevant previous attempts without replaying the entire conversation. |
| P2 | **Unclear current truth:** old and new facts coexist without a reliable answer about which governs. | Current recall returns the accepted current fact; history preserves prior facts; conflicting or ambiguous claims enter review. |
| P3 | **Agent coordination:** parallel workers can duplicate work, lose updates, or hand off without context. | Concurrent task claims have one owner; handoffs require acknowledgement; a restart preserves task state. |
| P4 | **Memory privacy and poisoning:** shared memory may disclose restricted information or treat attacker-controlled text as authoritative. | Tenant and group boundaries hold across every path; external content cannot grant access, forge approval, or silently gain trusted status. |
| P5 | **Fragmented and stale knowledge:** owners, decisions, documents, tickets, and code changes live in separate sources and age at different rates. | A multi-source answer follows current relationships and shows source version and freshness. Failed or partial imports remain visible. |
| P6 | **Missing decision rationale:** records often show outcomes without the evidence, approver, or reason. | Decisions record evidence, rationale, approver, action, and outcome. Missing rationale is reported as undocumented. |
| P7 | **Incomplete multi-hop answers:** similarity search alone may omit a relationship needed to answer a connected question. | Bounded graph traversal assembles a sourced path; missing links lead to an explicit gap or abstention. Compare against a text-only baseline. |
| P8 | **Entity identity errors:** aliases can split one person into several nodes, while similar names can merge different people. | Exact identifiers and explicit aliases resolve; ambiguous names stay separate until reviewed. |
| P9 | **Opaque context and confusing tools:** people cannot inspect what reached the agent, while overlapping tools waste context and cause selection errors. | A run view shows selected sources, memory versions, tool calls, and truncation. Keep the MCP surface small and unambiguous. |
| P10 | **Memory clutter and ineffective deletion:** old context competes with useful facts, and supposedly deleted information may remain recoverable in derived content. | Retrieval is bounded and current by default. Explicit forgetting blocks and removes content from derived live records and search paths before reporting completion. |

## Three-day beta scope

**Target:** cloud-hosted self-serve beta in 72 hours. New users sign in, create an isolated workspace, load public or synthetic data, ask a question, connect an MCP client, and approve a sandbox action. There is no payment collection.

### User journey

1. Sign in through Supabase Auth and create a workspace.
2. Provision an isolated FalkorDB graph and seed the fictional Northwind Payments company.
3. Import Markdown/JSON and a public GitHub README, issues, and pull requests. Limit a GitHub import to 100 artifacts.
4. Ask why an engineering project is delayed; inspect cited documents, tickets, owners, and dependency paths.
5. Investigate a checkout incident; recover prior attempts; hand the task to a responder agent.
6. Review and approve a sandbox rollback tied to its target, arguments, and evidence versions.
7. Start a new session and retrieve the outcome and applicable procedure.
8. Exercise restricted access and selective forgetting; verify they affect recall, histories, derived answers, and active runs.

### Stack and deployment

| Area | Decision |
|---|---|
| Web | Next.js, TypeScript, Tailwind, shadcn/ui, Cytoscape.js for focused evidence subgraphs. |
| API and agent service | Python 3.12, FastAPI, Pydantic, official Python MCP SDK. |
| Identity and control plane | Supabase Auth and Postgres. Verify token signature, issuer, audience, and expiry. Resolve workspace membership on the server. |
| Context and workflow state | FalkorDB Cloud, one graph per workspace; derive graph names server-side. |
| Background work | One worker using durable Postgres jobs. |
| Hosting | Vercel web app; Railway API and worker. Keep FalkorDB in managed cloud. |
| LLM | Anthropic SDK; record model ID and prompt/config revision with each evaluation. |

Use a modular monolith. REST, MCP, and the worker call the same application services. Supabase stores users, memberships, API-key metadata, and durable job state. FalkorDB stores knowledge, temporal fact versions, provenance, tasks, approvals, traces, and action outcomes.

### Knowledge and evidence

- Start from the draft ontology: Person, Team, Service, Project, Artifact, Decision, Fact, Event, Session, Task, Agent, Action, and Procedure. Add a node or edge only when the workflow needs it.
- Every knowledge-bearing relationship has source ID, capture time, access groups, and confidence where available.
- Preserve source revisions. A changed or interrupted import must not erase valid assertions from unrelated sources.
- Require a source span for extracted relationships. Keep uncertain claims as candidates; an LLM-generated guess cannot become documented rationale.
- Resolve names from exact identifiers and explicit aliases. Do not auto-merge fuzzy name matches in this beta.
- Retrieve with alias/full-text lookup followed by authorized graph traversal capped at four hops. Do not require vector embeddings in the initial release.
- Return structured factual claims with source IDs and graph paths. Check that citations exist and are accessible; evaluate factual support separately.

### Memory and coordination

- Separate episodic events, semantic facts, and procedures. Store failed attempts and rejected actions as events with conditions and source evidence.
- Use a stable subject/predicate slot with a monotonic version. Fact versions must not reset the concurrency token.
- A mutation atomically writes the slot/version change, operation receipt, and audit event. Repeated operation IDs return the original result; reusing an ID for different input is rejected.
- Return `409 version_conflict` for stale writes; do not silently overwrite after rereading. Distinguish corroboration, supersession, disputes, and multi-valued predicates.
- Current recall excludes superseded facts. Historical recall is explicit. Ownership fact changes update the ownership relationship atomically.
- Task claims and handoffs validate owner, version, state, and lease expiry. Only the handoff recipient may acknowledge; expired handoffs cannot be accepted.
- Before proposing an action, retrieve applicable failed attempts. If proposing a previously failed approach, require the agent to explain the changed conditions. Past failure is advisory, not an unconditional ban.
- Construct restart context from current facts, relevant attempts, open tasks, and recent outcomes within a fixed configurable token budget. Show these selected items in the console and offer authorized Markdown/JSON export.

### Trust, permissions, actions, and forgetting

- Derive agent identity and scopes from a server-validated, workspace-bound key. Never accept a client-provided graph name, trust tier, approver identity, or permission claim.
- Filter permissions on every node, edge, source, historical item, stored answer, and trace before returning content. A derived summary cannot have broader access than its evidence.
- Untrusted source content is data, never an instruction or approval. Quarantine candidate memories from external content until explicitly reviewed; review re-runs normal fact rules and preserves original origin.
- Implement one action: sandbox deployment rollback. Agents can propose only. Human approval is bound to action target, arguments, and evidence versions; changes invalidate approval. Action ID prevents duplicate execution.
- Record procedure success only after an observed sandbox outcome, labeled as sandbox.
- Forgetting is human-only. Record derivation edges for facts, summaries, answers, and procedures. On request, immediately block content and invalidate related pending proposals; cancel or restart active runs that could expose the content. Remove content across the full derivation closure and searchable live data before returning success. Keep content-free audit metadata. Document external-provider and backup retention accurately.

### Interfaces and console

Expose seven MCP tools: `resolve`, `trace`, `recall`, `remember`, `task`, `propose_action`, and `explain`. Approval and forgetting remain human-only REST operations. Tool outputs include trace IDs, source versions, and truncation indicators. Long jobs return a durable job/run ID and stream progress through authenticated SSE.

The console has five areas: **Ask** (citations and context used), **Knowledge** (sources, freshness, entity review, graph), **Memory** (current/history, attempts, tasks, review, export/forget), **Investigations** (timeline, handoffs, approvals, outcomes), and **Settings** (workspace, keys, quotas, deletion). Every failure state is visible and recoverable.

## Delivery sequence and proof

| Window | Build | Gate |
|---|---|---|
| Day 1 | Supabase auth, workspace membership, per-workspace FalkorDB graph, synthetic data, source lineage, fact slots, versioned writes, basic console. | Tenant isolation holds; restart persistence works; stale writes fail; current and historical recall differ. |
| Day 2 | Imports, connected Q&A, MCP tools, previous-attempt lookup, task lease/handoff, incident investigator, sandbox approval and execution. | Complete one incident end-to-end and resume it in a fresh agent session. |
| Day 3, first half | Selective forgetting and derivation closure, access controls, context inspection/export, onboarding, retryable failures. | Restricted and deleted content stays unavailable through recall, history, stored answers, and affected active runs. |
| Day 3, second half | Evaluation, browser workflow check, documentation, video, submission. Freeze features for the final six hours. | Deployed beta and complete local setup with reproducible results and all three track entries. |

### Acceptance scenarios

- **P1/P9:** restart across sessions; measure relevant recall and context tokens.
- **P2:** same-value corroboration, valid update, conflicting authority, backdated fact, multi-value fact, and historical query.
- **P3:** 50 workers × 20 attempted updates; account for commits, conflicts, and retries. Test duplicate completion, lease expiry, and expired handoff acknowledgement.
- **P4:** cross-tenant identifiers, restricted intermediate nodes, revoked key, forged approval text, and poisoned content retrieved in a later session.
- **P5/P7/P8:** unchanged import, changed source, interrupted import, missing relationship, aliases, and duplicate names.
- **P6:** documented rationale, missing rationale, unsupported claim, rejected proposal, and failed sandbox outcome.
- **P10:** deletion followed by direct, historical, paraphrased, derived-answer, procedure, and active-run recovery attempts.

Evaluate 40 fixed synthetic cases: 10 connected knowledge, 10 changing/current facts, 10 restart/attempt/handoff, and 10 missing-evidence/access/deletion. Compare full-text-only retrieval and plain Markdown memory using the same corpus, model, and context budget. Record dataset hash, model, prompt/config revision, code revision, latency, token usage, failures, and results. Report authorized-answer quality separately from refusal and deletion behavior. Make no “graph wins” claim without measured results.

## Assumptions and deferred work

- Preserve Waypoint as the working name and use the engineering incident as the unifying workflow.
- Use public and synthetic information only. No real Slack/Jira tenancy or private repository access in the three-day beta.
- Require cloud credentials and a working model key on Day 1. Keep a complete local setup as the fallback.
- Defer billing, private connectors, vector embeddings, automatic fuzzy entity merges, automated decay, full time-travel query APIs, and additional action adapters.
- The contest brief supports entering all three tracks. Recheck submission fields and current rules at submission time.

## Artifacts

- [Research verification ledger](docs/research-verification.md)
- [Architecture diagram](docs/architecture.mmd)
- Source materials preserved: `part1.md`–`part4.md` and `Graph_Hacks_Master_Research_Archive.pdf`.

# Waypoint — build plan

**Waypoint is an action-first agent for connected operational data.** One graph/MCP/memory engine supports three workflow packs: investigate fraud patterns, triage security findings, and work through a codebase. Each pack connects its real source records to related entities, preserves provenance and access controls, and lets an agent propose a bounded next action with an explanation. GitHub changes and cloud deployment actions require human approval of the exact proposal. Fraud records produce analyst recommendations only until an authorized case-system action is explicitly designed and integrated. The primary track is Agents That Act on Connected Data, supported by Company Brain and Agent Memory and Coordination.

## Product promise

The agent uses one shared connected-data workflow across three domains:

- **Fraud investigation:** trace a suspicious transaction through accounts, devices, counterparties, and prior cases; explain risk signals and recommend analyst review without presenting correlation as proof.
- **Security triage:** trace a finding through advisories, dependencies, repositories, services, deployments, and owners; verify affected revisions before proposing remediation.
- **Codebase work:** trace issues through modules, commits, tests, owners, decisions, and previous attempts; propose a reviewable repository change when evidence supports it.

For security and codebase work, the agent can propose a repository change or deployment rollback, wait for approval tied to exact inputs and evidence versions, execute with scoped credentials, verify the provider outcome, and preserve the result for later authorized sessions. Fraud disposition remains an analyst decision until a case provider and action policy are selected.

| Product capability | Hackathon track | User result |
|---|---|---|
| Actions — primary | T1 Agents That Act on Connected Data | Select graph/MCP tools, investigate relationships, propose and execute approved GitHub and cloud actions, and verify outcomes. |
| Brain — supporting | T3 Company Brain | Connect source-controlled engineering and operational records with inspectable provenance and paths. |
| Memory — supporting | T2 Agent Memory and Coordination | Preserve prior attempts, current facts, task ownership, and acknowledged handoffs across sessions. |

The three domain packs share the graph, MCP, authorization, audit, and memory core; they are not three separate products. Investigations persist a selected workflow domain, and model runs use the corresponding fraud, security, or codebase evidence guidance; legacy/API-created investigations without a selection retain a general mode. Each domain still needs a real, authorized source adapter before it can pass acceptance. The implementation now includes a read-only workspace Ask flow that creates a durable investigation and runs the OpenAI-compatible agent with every write permission disabled, plus codebase/optional Dependabot import for connected GitHub repositories. The codebase importer records bounded CI check runs for the default-branch head as commit-linked graph evidence and links up to 20 changed-file paths for each of the first ten returned pull requests, without importing file contents. No model provider is configured, and source adapters have not been verified against live cloud services; deployment and fraud sources are not implemented. Synthetic evaluation fixtures do not establish real-data behavior.

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

## Focused alpha scope

**Target:** a cloud-hosted working alpha on real data for fraud investigation, security triage, and codebase work through shared infrastructure and domain-specific source adapters. Synthetic records are test fixtures only and do not satisfy integration acceptance. No delivery date is assumed. Release requires durable state, tenant isolation, recovery, and source-linked evidence for every workflow. External actions stay disabled until their provider-specific approval, idempotency, and verification gates pass.

### User journey

1. Authenticate and resolve workspace membership on the server.
2. Connect the explicitly selected read-only source systems for each enabled workflow: a GitHub repository and deployed service, a fraud case/transaction source, and a security finding/advisory source. Store scoped credentials outside source control.
3. Import revisions and provenance; expose partial failures and preserve prior valid data.
4. Investigate a fraud signal, security finding, or codebase issue with MCP-selected graph queries across its relevant entities, owners, decisions, and previous attempts.
5. Show evidence paths, source versions, alternatives, and uncertainty; abstain when evidence is missing.
6. Propose either a GitHub change or cloud deployment action; bind human approval to exact inputs and evidence versions.
7. Execute idempotently, verify the external provider result and health, then persist the observed outcome.
8. Restart the session and recover the investigation and outcome subject to current access and deletion rules.

### Stack and deployment

| Area | Decision |
|---|---|
| Web | Next.js, TypeScript, Tailwind, shadcn/ui, Cytoscape.js for focused evidence subgraphs. |
| API, agent, and MCP | TypeScript server-side application services in the existing Next.js app; official TypeScript MCP SDK. Add a separately deployed worker only for durable jobs that cannot run safely in request handlers. |
| Identity and control plane | Supabase Auth and Postgres. Verify signed claims, resolve membership on the server, and enforce RLS for control-plane reads. |
| Context graph | FalkorDB Cloud, one graph per workspace; derive graph names server-side. Keep provenance-rich entities and relationships queryable for multi-hop reasoning. |
| Durable mutable workflow state | Supabase Postgres for investigations, task leases/handoffs, idempotency receipts, approvals, and audit history. Use a transactional outbox before projecting these records into the graph. |
| Background work | A manually configured host scheduler runs `bun run worker:graph-projection`; it pulls a bounded batch from the Postgres outbox under a worker lease. |
| Hosting | The user will deploy the Next.js web/API manually on their selected host. Keep FalkorDB and Supabase managed in cloud. Do not use Docker. |
| LLM | Select a managed model provider during implementation; record model ID and prompt/config revision with each evaluation. |

Use a modular monolith. REST, MCP, and any worker call the same application services. Supabase stores users, memberships, credential metadata, authoritative mutable workflow state, and durable jobs. FalkorDB Cloud stores connected source knowledge, temporal facts, provenance, and graph projections used for multi-hop reasoning. Replicate Postgres workflow changes through a transactional outbox; do not dual-write both stores in a request. Never accept a graph name, approver identity, or permission claim from a client.

### Knowledge and evidence

- Start from the draft ontology: Person, Team, Service, Project, Artifact, Decision, Fact, Event, Session, Task, Agent, Action, and Procedure. Add a node or edge only when the workflow needs it.
- Every knowledge-bearing relationship has source ID, capture time, access groups, and confidence where available.
- Preserve source revisions. A changed or interrupted import must not erase valid assertions from unrelated sources.
- Require a source span for extracted relationships. Keep uncertain claims as candidates; an LLM-generated guess cannot become documented rationale.
- Support domain entities needed by the enabled workflows, including Account, Transaction, Device, Finding, Vulnerability, Dependency, CodeModule, Service, Deployment, Person, Team, Decision, and Attempt. Add entities only with source identity and provenance; do not create cross-domain identity links from fuzzy similarity alone.
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
- Implement GitHub changes and cloud deployment rollback through provider APIs. Agents can propose only. Human approval is bound to action target, exact arguments, and evidence versions; changes invalidate approval. Idempotency keys prevent duplicate effects.
- Restrict initial deployment actions to a designated non-production environment. Verify provider state and service health before recording success; reconcile uncertain outcomes before retrying.
- Forgetting is human-only. Record derivation edges for facts, summaries, answers, and procedures. On request, immediately block content and invalidate related pending proposals; cancel or restart active runs that could expose the content. Remove content across the full derivation closure and searchable live data before returning success. Keep content-free audit metadata. Document external-provider and backup retention accurately.

### Interfaces and console

Expose the seven MCP capability groups: `resolve`, `trace`, `recall`, `remember`, `task`, `propose_action`, and `explain`. The current endpoint publishes thirteen concrete tools across these groups and three prompt templates for fraud, security, and codebase investigations. Approval and forgetting remain human-only REST operations. Tool outputs include trace IDs, source versions, and truncation indicators. Long agent runs now have durable run IDs and authenticated SSE progress backed by persisted events, with reconnect support through event IDs; deployed-host streaming remains unverified.

The console has five areas: **Ask** (citations and context used), **Knowledge** (sources, freshness, entity review, graph), **Memory** (current/history, attempts, tasks, review, export/forget), **Investigations** (timeline, handoffs, approvals, outcomes), and **Settings** (workspace, keys, quotas, deletion). Every failure state is visible and recoverable.

## Delivery sequence and proof

Delivery is milestone- and evidence-based; no three-day release commitment is assumed. The authoritative task list and current status live in [IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md). Work proceeds through cloud identity/isolation, real source ingestion, graph-driven MCP investigation, durable memory/coordination, approved GitHub actions, approved deployment actions, trust/operations, and measured alpha evaluation. Each milestone has a gate; downstream actions stay disabled until their authorization and recovery gates pass.

### Acceptance scenarios

- **P1/P9:** restart across sessions; measure relevant recall and context tokens.
- **P2:** same-value corroboration, valid update, conflicting authority, backdated fact, multi-value fact, and historical query.
- **P3:** 50 workers × 20 attempted updates; account for commits, conflicts, and retries. Test duplicate completion, lease expiry, and expired handoff acknowledgement.
- **P4:** cross-tenant identifiers, restricted intermediate nodes, revoked key, forged approval text, and poisoned content retrieved in a later session.
- **P5/P7/P8:** unchanged import, changed source, interrupted import, missing relationship, aliases, and duplicate names.
- **P6:** documented rationale, missing rationale, unsupported claim, rejected proposal, and failed sandbox outcome.
- **P10:** deletion followed by direct, historical, paraphrased, derived-answer, procedure, and active-run recovery attempts.
- **Fraud:** transaction-to-account/device/counterparty/prior-case paths, source-version freshness, false-positive uncertainty, restricted financial data, and no hold/reversal without analyst authorization.
- **Security:** finding-to-advisory/dependency/repository/service/deployment paths, affected-version verification, restricted findings, and no remediation success claim before provider verification.
- **Codebase:** issue-to-module/commit/test/owner/decision paths, ambiguous ownership, failed attempts, and patch proposals bound to exact revisions.

Use synthetic cases as automated regression fixtures only. Separately evaluate the product on authorized real engineering data before making production or customer-value claims. Compare graph-enabled runs with text retrieval and plain Markdown memory using the same corpus, model, and context budget. Record dataset identity/consent, model, prompt/config revision, code revision, latency, token usage, failures, and results. Report authorized-answer quality separately from abstention, access control, and deletion behavior. Make no “graph wins” claim without measured results.

## Assumptions and deferred work

- Preserve Waypoint as the working name and use the shared connected-data investigation as the unifying workflow across fraud, security, and codebase packs.
- Fraud source provider, security finding/advisory provider, model provider, and per-domain action policies must be selected before their live acceptance gates can pass; do not infer provider credentials from unrelated project settings.
- Use real repository and deployment integrations for alpha acceptance; obtain explicit target and least-privilege credentials before connecting. Synthetic information is limited to test fixtures.
- Require managed cloud services and working model/provider credentials before runtime integration gates. No Docker-based fallback.
- Defer billing, private connectors, vector embeddings, automatic fuzzy entity merges, automated decay, full time-travel query APIs, and additional action adapters.
- The contest brief supports entering all three tracks. Recheck submission fields and current rules at submission time.

## Artifacts

- [Research verification ledger](docs/research-verification.md)
- [Architecture diagram](docs/architecture.mmd)
- [Implementation tracker](IMPLEMENTATION_TRACKER.md)
- Source materials preserved: `part1.md`–`part4.md` and `Graph_Hacks_Master_Research_Archive.pdf`.

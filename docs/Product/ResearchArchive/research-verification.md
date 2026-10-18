# Research link verification ledger

Checked 15 October 2026 against the 54 records in `Graph_Hacks_Master_Research_Archive.pdf`. “Readable” means the URL returned identifiable source material or metadata; it does not mean every claim was independently validated. See [MASTER_PLAN.md](../MASTER_PLAN.md) for how evidence strength limits product claims.

| ID | Source | Check result | Use and caveat |
|---|---|---|---|
| D.01 | [Mem0 discussion #4787](https://github.com/mem0ai/mem0/discussions/4787) | Readable; discussion and replies verified. | Firsthand question and small audit. Audit uses 24 facts; not a scale study or proof of Mem0 defect. Supports testing supersession separately from contradiction. |
| D.02 | [Claude Code issue #44098](https://github.com/anthropics/claude-code/issues/44098) | Readable; closed as not planned. | Specific feature request about configurable Cowork memory paths and cross-device continuity; not universal prevalence. |
| D.03 | [claude-memory](https://github.com/KeerthX/claude-memory) | Repository readable. | Implementation reference, not demand evidence. |
| D.04 | [claude-memory-context](https://github.com/malbers/claude-memory-context) | Repository readable. | Implementation reference, not demand evidence. |
| D.05 | [claude-code-memory](https://github.com/LuciferForge/claude-code-memory) | Repository readable. | Implementation reference, not demand evidence. |
| D.06 | [AXME Code plugin](https://github.com/axmeai/axme-code-plugin) | Repository readable. | Implementation reference; no general capability claim adopted. |
| D.07 | [Aegis Memory](https://github.com/quantifylabs/aegis-memory) | Repository/readme readable. | Existing project documents provenance, trust, scopes, and key-bound identity. Vendor/project feature claims are not independent validation. |
| D.08 | [Engram](https://github.com/engram-memory/engram) | Repository/readme readable. | Existing memory implementation reference; claims on its readme are project claims. |
| D.09 | [PowerMem, original URL](https://github.com/cr7258/powermem) | Original URL returned 404. | Do not cite as live. Replacement checked: [OceanBase PowerMem](https://github.com/oceanbase/powermem). Different repository path; no claim that it is a redirect or identical fork. |
| D.10 | [MoltFlow](https://github.com/mithun50/MoltFlow) | Repository/readme readable. | **Corrected:** agent Q&A platform, not a workflow-state or coordination engine. |
| D.11 | [Stack-MCP](https://github.com/stackexchange/stack-mcp) | Repository readable. | Integration reference. |
| D.12 | [unified-agent-context on PyPI](https://pypi.org/project/unified-agent-context/) | Package page readable. | Package identity/metadata only; no feature audit. |
| D.13 | [recall-agents on PyPI](https://pypi.org/project/recall-agents/) | Package page readable. | Package identity/metadata only; no feature audit. |
| D.14 | [Agents Radar issue #1032](https://github.com/THTHDGCS/agents-radar/issues/1032) | Digest readable; original linked research followed. | Secondary generated digest is not primary evidence. See D.55–D.56. |
| D.15 | [DanKornas X post](https://x.com/DanKornas/status/2104311123285848477) | Could not retrieve/verify post. | Exclude claims. |
| D.16 | [akshay_pachaar X post](https://x.com/akshay_pachaar/status/2105583178589372779) | Could not retrieve/verify post. | Exclude claims. |
| D.17 | [Mem0 X post](https://x.com/mem0ai/status/1970252276280250536) | Could not retrieve/verify post. | Exclude claims; in any case vendor material is not independent evidence. |
| D.18 | [Semantic layers vs. context graphs](https://www.linkedin.com/posts/ahenkin_context-graph-vs-semantic-layer-for-ai-agents-activity-7478424817059270656-OtIh) | Readable. | Vendor-associated conceptual argument, not controlled evaluation. |
| D.19 | [Context graph post](https://www.linkedin.com/posts/jedify-com_the-context-graph-for-ai-agents-explained-activity-7472560348831793152-bovg) | Readable. | Vendor perspective; no quantitative claim adopted. |
| D.20 | [Temporal knowledge graph post](https://www.linkedin.com/posts/bijit-ghosh-48281a78_agents-that-remember-temporal-knowledge-activity-7316626540719476736-XtCH) | Readable. | Practitioner explanation, not independent benchmark. |
| D.21 | [Knowledge graphs for agents](https://www.linkedin.com/posts/svpino_knowledge-graphs-are-a-game-changer-for-ai-activity-7297253976121458688-xdg8) | Readable. | Opinion/reference, not proof of graph advantage. |
| D.22 | [How agents can learn to forget](https://www.linkedin.com/posts/rama1_refactoring-memory-why-ai-agents-must-learn-activity-7336426627544862720-QKJl) | Readable. | Opinion/reference. Supports considering forgetting, not a particular decay algorithm. |
| D.23 | [HN: Universal Memory Protocol](https://news.ycombinator.com/item?id=48428796) | Thread readable. | Includes skepticism about complexity and file-system alternatives; supports baseline comparison. Comments are not a representative survey. |
| D.24 | [HN: Agent Memory: An Anatomy](https://news.ycombinator.com/item?id=48287808) | Thread readable; flagged. | Discussion includes criticism of density and questions about component necessity. Not demand measurement. |
| D.25 | [HN: Context Engineering for Agents](https://news.ycombinator.com/item?id=44432596) | Thread readable. | Mixed opinions; no statistical claim adopted. |
| D.26 | [HN: Context engineering lessons](https://news.ycombinator.com/item?id=45352901) | Thread readable. | Comment advocates simple file-based memory; useful baseline idea. Anecdotal. |
| D.27 | [HN: Effective context engineering](https://news.ycombinator.com/item?id=45418251) | Thread readable. | Users discuss context visibility and evaluation. Anecdotal; informs context-inspection UI and evaluation. |
| D.28 | [Stack Overflow for Agents announcement](https://stackoverflow.blog/2026/06/10/announcing-stack-overflow-for-agents/) | First-party announcement readable. | Product/market context; not independent evidence that Waypoint’s pain points are prevalent. |
| D.29 | [Intelligent forgetting](https://dev.to/sudarshangouda/ai-agent-memory-part-2-the-case-for-intelligent-forgetting-4i48) | Article readable. | Practitioner article; its reported benchmark figures were not independently reproduced and are not used. |
| D.30 | [Memory store design](https://dev.to/jackm-singularity/ai-agent-memory-store-stop-long-running-agents-from-forgetting-the-job-3nl5) | Article readable. | Implementation discussion, not controlled demand evidence. |
| D.31 | [Agent memory in 60 seconds](https://dev.to/theagentloop/agent-memory-in-60-seconds-why-your-agent-forgets-by-tomorrow-425n) | Article readable. | Explainer only. |
| D.32 | [Persistent memory in LangGraph](https://dev.to/focused_dot_io/persistent-agent-memory-in-langgraph-1c4a) | Article readable. | Implementation guide; framework behavior should be checked against current official docs before reuse. |
| D.33 | [“88% of pilots fail” article](https://dev.to/stacknotice/ai-agents-in-production-why-88-of-enterprise-pilots-fail-2026-2g0b) | Article readable; no adequate primary methodology/source established in the inspected page. | Do not use the 88% statistic. Gartner’s separate forecast is D.44. |
| D.34 | [MCP tool-count article](https://dev.to/merlonix/how-many-mcp-tools-is-too-many-tool-count-selection-overload-7gc) | Article readable. | Author’s stated 40–50 threshold is not independently established; do not use as a universal rule. |
| D.35 | [The Goldfish with a User Interface](https://theagentarchitect.substack.com/p/goldfish-memory-ai-agents) | Article readable. | Opinion/market framing, not independent measurement. |
| D.36 | [The Enterprise Graph](https://wrk3.substack.com/p/the-enterprise-graph-the-missing) | Corrected URL readable after removing archive query string. | Explicitly notes Glean support; treat as sponsored perspective, not neutral measurement. |
| D.37 | [Context graphs explained](https://airealizednow.substack.com/p/context-graphs-the-missing-layer) | Article readable. | Cites Foundation Capital and other sources; opinion synthesis, not independent validation. |
| D.38 | [Agentic memory in the enterprise](https://matthewkruczek.ai/blog/agentic-memory-enterprise-ai) | Article readable. | Secondary practitioner article. Compliance statistics are not adopted. |
| D.39 | [Multi-agent failures guide](https://futureagi.substack.com/p/why-do-multi-agent-llm-systems-fail) | Article readable. | Secondary summary. Prefer primary MAST paper D.45. |
| D.40 | [Foundation Capital context graph thesis](https://foundationcapital.com/ideas/why-context-graphs-are-the-missing-layer-for-ai) | Article/transcript readable. | Investor thesis and practitioner anecdotes; supports a hypothesis around decision lineage, not customer demand or measured gains. |
| D.41 | [DZone: From Outcomes to Decisions](https://dzone.com/articles/context-graphs-from-outcomes-to-decisions) | Article readable. | Commentary; no quantitative claim adopted. |
| D.42 | [diginomica context graphs](https://diginomica.com/context-graphs-unlock-new-seam-enterprise-knowledge-ai-agents) | Article readable. | Industry commentary; no quantitative claim adopted. |
| D.43 | [Cirrius decision control](https://cirriussolutions.com/the-context-graph-building-agent-decision-control/) | Article readable. | Vendor framing; not independent evidence. |
| D.44 | [Forbes article on Gartner forecast](https://www.forbes.com/sites/robertszczerba/2026/07/07/why-40-of-agentic-ai-projects-may-be-canceled-by-2027/) and [Gartner source](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027) | Forbes readable; forecast traced to Gartner. | Forecast for 2027, not observed failure rate. Do not describe as “40% have failed.” |
| D.45 | [MAST paper](https://arxiv.org/abs/2503.13657) | Abstract and metadata verified. | Reports a taxonomy of 14 failure modes in 3 categories using its dataset; does not specifically establish write-conflict rates. |
| D.46 | [GateMem paper](https://arxiv.org/pdf/2606.18829) | Full paper accessible; abstract, design, and examples inspected. | Benchmark of 91 episodes and 2,218 checkpoints; results are benchmark-specific. Directly motivates jointly testing authorized utility, access control, and deletion. |
| D.47 | [Governed Collaborative Memory](https://arxiv.org/pdf/2605.04264) | Full paper accessible; abstract and design claims inspected. | Viewpoint/design agenda with illustrative traces; authors explicitly do not establish causal superiority. |
| D.48 | [SAMEP paper](https://arxiv.org/pdf/2507.10562) | Full text accessible; abstract/intro inspected. | Independent preprint with broad performance/security claims; not independently reproduced; do not use its headline percentages. |
| D.49 | [Codified Context](https://arxiv.org/pdf/2602.20478) | Full text accessible; abstract/intro inspected. | One project case study; useful for continuity ideas, not a general benchmark. |
| D.50 | [PROJECTMEM](https://arxiv.org/pdf/2606.12329) | Full text accessible; abstract and limitations inspected. | Author-run self-study and synthetic latency benchmark. Authors state it does not show warnings prevent repeated failures. Supports measuring, not assuming, this feature. |
| D.51 | [Graph-native bitemporal memory](https://arxiv.org/pdf/2607.26520) | Full text accessible; abstract/intro inspected. | 60 sampled LongMemEval questions; reports different performance by question type and a temporal-reasoning recall trade-off. Not a production-scale result. |
| D.52 | [Mem0 paper](https://arxiv.org/pdf/2504.19413) | Full paper accessible; abstract inspected. | Author/vendor paper reports benchmark comparisons; results are paper-specific, not an independent product guarantee. |
| D.53 | [DocSage paper](https://arxiv.org/pdf/2603.11798) | Full paper accessible; abstract and limitations inspected. | Multi-document QA study; reports results on its benchmarks, with model/cost and source-consistency limitations. It is **not** the FalkorDB GraphRAG benchmark. |
| D.54 | [Official Graph Hacks page](https://www.wemakedevs.org/hackathons/falkordb) and [rules](https://www.wemakedevs.org/hackathons/falkordb/rules) | Current pages readable. | Confirms challenge framing and FalkorDB centrality; recheck rules and submission fields at submission time. |
| D.55 | [Memory poisoning primary study](https://arxiv.org/html/2606.04329v2) | Retrieved by following D.14; paper readable. | Evaluates write channels and attack types in two agent systems. Results are scoped to its models/setup, not prevalence across deployed assistants. |
| D.56 | [Microsoft AI recommendation poisoning](https://www.microsoft.com/en-us/security/blog/2026/02/10/ai-recommendation-poisoning/) | Retrieved by following D.14; first-party security post readable. | Documents observed promotional attempts and mitigations. Does not establish that every attempt succeeded or give general prevalence. |
| D.57 | [Anthropic context engineering guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Retrieved from D.27; first-party guidance readable. | Recommends curated context and clear, non-overlapping tools; provider guidance, not a cross-provider benchmark. |
| D.58 | [Manus context engineering article](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) | Retrieved from D.26; article readable. | Practitioner implementation perspective. |
| D.59 | [OceanBase PowerMem](https://github.com/oceanbase/powermem) | Replacement repository/readme checked after D.09 404. | Existing implementation reference; product claims remain maintainer claims. |

## Evidence limits to keep visible

- D.15–D.17 remain unverified. Do not infer their contents from account names or URL IDs.
- D.09 is a dead original URL. D.59 is a separately checked replacement, not a confirmed redirect.
- The D.33 88% figure lacks a verified primary basis in the inspected article. Leave it out of the pitch.
- D.34’s tool-count threshold is an author claim. We adopt a small tool surface for clarity and testability, not because “40–50” is a proven boundary.
- D.46, D.50, D.51, and D.53 motivate local tests but use benchmark/study conditions that differ from Waypoint’s beta.
- Vendor and investor commentary can help form hypotheses; it does not establish willingness to buy or comparative product advantage.

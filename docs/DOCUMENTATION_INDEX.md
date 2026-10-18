# Documentation index

| Area | Read this for |
|---|---|
| [API](API/API_REFERENCE.md) | Every REST route and all 18 MCP tools, request hardening. |
| [Architecture](Architecture/SYSTEM_ARCHITECTURE.md) | System diagram, the agent-run sequence, the approval-to-draft-PR sequence, trust boundaries. |
| [Graph model](Architecture/GRAPH_MODEL.md) | What's actually in FalkorDB today, the real traversal Cypher, entity resolution. |
| [Backend](Backend/BACKEND_GUIDE.md) | Module map, the agent loop's invariants, the known write-run bug. |
| [Database](Database/DATABASE_DESIGN.md) | Supabase schema by concern, migration order, idempotency rules. |
| [Decisions](Decisions/DECISIONS.md) | Why the system is shaped the way it is — short-form ADRs. |
| [Deployment](Deployment/DEPLOYMENT_GUIDE.md) | Local setup (Docker FalkorDB), managed services, env vars, release checklist. |
| [Development](Development/DEVELOPMENT_GUIDE.md) | Pre-PR checks, conventions, and gotchas worth knowing before you touch specific areas. |
| [Frontend](Frontend/FRONTEND_GUIDE.md) | Routes, the Cockpit, component sources, the labeled sample graph. |
| [Operations](Operations/OPERATIONS_GUIDE.md) | Credential rotation, deletion/retention, recovery, incident response, demo-recording standard. |
| [Product plan](Product/PRODUCT_PLAN.md) | Pain points and proof contract, user journey, stack, what's deferred. |
| [Impact and evidence](Product/IMPACT_AND_EVIDENCE.md) | What's actually verified vs. offline-tested vs. not yet shown, by level. |
| [Research archive](Product/ResearchArchive/) | The unedited source material and link-strength audit behind the pain-point list. |
| [Eval results](Product/eval-results/) | Raw `eval:compare` output and the honest read of what it does/doesn't show. |

Start at the root [README](../README.md) for the quick start and product overview; this
index is for going deeper into a specific area.

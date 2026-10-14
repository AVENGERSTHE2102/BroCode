# Local demo and release readiness

## Run the current preview

```sh
npm install
cp .env.example .env.local
# Put your FalkorDB Cloud connection URL in .env.local first.
npm run seed:demo
npm run dev
```

Open the local Next.js URL and walk through these seeded screens:

1. **Overview:** ask “What changed before the payment incident?” and inspect the seeded answer and its three evidence sources.
2. **Knowledge:** follow the checkout service → deploy #1842 → INC-284 → retry policy path.
3. **Memory:** compare current V2 with superseded V1.
4. **Investigations:** inspect the incident timeline and preview the proposed handoff.
5. **Settings:** confirm the workspace is marked as local demo data and that connection, key, export, and deletion controls are unavailable.

With `FALKORDB_URL` configured and the synthetic seed loaded, Ask calls the server API, which performs a bounded four-hop FalkorDB query and returns graph records with their source IDs. Without a working cloud connection, Ask labels and shows the bundled demo response. Approval and handoff remain local previews; they do not persist state or execute a deployment. Use synthetic data only.

## Verification recorded

- Production build passed with `npm run build` on 15 October 2026.
- Browser walkthrough passed against the local app on 15 October 2026: seeded question submission, Knowledge evidence path, Memory current/history, Investigations timeline, and Settings disclosure were visible.
- This verifies the local preview flow only. It does not cover restart persistence, authorization, imports, action execution, deletion, mobile layout, or a deployed environment.
- The cloud URL is stored in the ignored, mode-600 `.env.local`, using the credential copied from the provider dashboard. FalkorDB Browser authenticated successfully and shows the `waypoint_demo` graph with 6 nodes and all 5 expected relationships. The bounded four-hop retrieval Cypher returned the six connected synthetic records in the browser. This verifies the cloud instance, graph data, and query shape. In this workspace, `npm run seed:demo` still fails with Node DNS `ENOTFOUND`, even though public DNS resolves the host and the provider browser connects. The app's Node API connection and cloud-backed Ask remain unverified until the seed script can run from a network-enabled Node environment.

## Day 3 release gate

The current tree is a UI prototype. These release items remain incomplete and must be evidenced before describing Waypoint as a deployed beta:

- Authenticated API, workspace membership enforcement, and per-workspace FalkorDB graphs. A single demo graph query path is implemented, but it is not tenant isolation.
- Durable imports, versioned memory, task handoffs, approval-bound sandbox actions, and selective forgetting.
- The 40-case evaluation with a text-only and Markdown baseline, including dataset/model/config/code revisions and measured results.
- Browser verification of the end-to-end workflow, including a fresh-session restart and access/deletion cases.
- A deployed environment with setup instructions and operational checks.
- A recorded demo video and completed submission for all intended tracks.

Do not claim graph superiority, persistent memory, tenant isolation, deletion completion, or action execution based on this local preview. Record those claims only after the corresponding gates pass against the running system.

## Graph Hacks submission checklist

The [official rules](https://www.wemakedevs.org/hackathons/falkordb/rules), checked 15 October 2026, require:

- FalkorDB as the primary graph database, doing work central to the product.
- A public source repository; a README with setup instructions and the graph data model; and the Cypher queries or graph algorithms the product depends on.
- A working demo video and either a live deployment or complete local setup instructions.
- The chosen track or tracks named in the submission. Waypoint's intended fit is all three: Agents That Act on Connected Data, Agent Memory and Coordination, and Company Brain.
- Disclosure of AI coding assistant use, plus a team that can explain and verify the graph model, queries, architecture, and technical decisions.

Current status against those requirements: the README, graph model, Cypher retrieval query, and cloud client code exist, but the repository is not public, cloud connectivity is not yet verified, there is no working video, and no app deployment. The preview alone does not meet the required graph-centrality rule. Do not submit until these items are implemented and evidenced.

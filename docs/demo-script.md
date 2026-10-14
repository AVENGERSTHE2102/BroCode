# Demo recording guide

Record only after `npm run seed:demo` succeeds and Settings reports the graph connected. Use synthetic Northwind Labs data throughout.

| Time | Show and say |
|---|---|
| 0:00–0:12 | Open Waypoint. “Waypoint gives engineering agents one place to recover connected company context and inspect the evidence behind an answer.” |
| 0:12–0:32 | Ask “What changed before the payment incident?” Show the connected answer and its evidence sources. “This answer traverses FalkorDB from incident INC-284 and returns source-linked records within four hops.” |
| 0:32–0:48 | Open Knowledge and follow checkout → deploy #1842 → INC-284 → retry policy. “The path is inspectable, so a responder can check why the answer was produced.” |
| 0:48–1:02 | Show the live `waypoint_demo` graph and its six nodes and five relationships in FalkorDB Browser. “The graph stores the connected demo records, rather than serving as a decorative visualization.” |
| 1:02–1:15 | Open Settings. “This build is a demo slice. Memory versioning, handoff persistence, authentication, and deployment actions are not implemented; the action shown in the UI is a local preview and does not execute.” |

Before recording, verify the cloud API route as well as the browser query: `GET /api/graph/health` must return `connected`, and a question from Overview must show `source: falkordb`. If either check fails, stop and fix the Node runtime connection first; do not record the bundled fallback as a live graph answer.

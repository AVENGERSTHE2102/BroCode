# Waypoint demo graph

The current cloud slice seeds a single synthetic Northwind Labs workspace graph named by the server-side `FALKORDB_GRAPH` setting. The browser cannot choose a graph name.

## Nodes

| Label | Stable `id` | Evidence fields |
|---|---|---|
| `Service` | `checkout` | `title`, `kind`, `source` |
| `Deployment` | `deploy-1842`, `deploy-1837` | `title`, `kind`, `source` |
| `Incident` | `INC-284` | `title`, `kind`, `source` |
| `Decision` | `decision-retry` | `title`, `kind`, `source` |
| `Person` | `maya-kim` | `title`, `kind`, `source` |

## Relationships

- `(Service)-[:HAS_DEPLOYMENT]->(Deployment)`
- `(Deployment)-[:TRIGGERED]->(Incident)`
- `(Incident)-[:INFORMED_BY]->(Decision)`
- `(Incident)-[:HAS_PREVIOUS_ATTEMPT]->(Deployment)`
- `(Service)-[:OWNED_BY]->(Person)`

The seed uses fixed synthetic literals with `MERGE` clauses, so rerunning it updates the same six demo nodes and five relationships. It checks that all six expected node IDs exist before reporting success.

## Retrieval query

The Ask endpoint accepts a bounded question string and only supports the seeded checkout incident today. User text is never interpolated into Cypher; the route queries the fixed demo incident ID and traverses no more than four graph hops:

```cypher
MATCH path = (incident:Incident {id: $incidentId})-[*0..4]-(related)
RETURN DISTINCT coalesce(related.id, related.title) AS id,
       coalesce(related.title, related.name, related.id) AS title,
       coalesce(related.kind, head(labels(related))) AS kind,
       coalesce(related.source, "") AS source,
       [node IN nodes(path) | coalesce(node.title, node.name, node.id)] AS path
LIMIT 30
```

The application returns source IDs and paths with the response. It assembles a short deterministic summary from returned records; this slice does not call an LLM or claim general-purpose question answering.

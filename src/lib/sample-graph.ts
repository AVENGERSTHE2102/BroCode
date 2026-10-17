import { withWorkspaceGraph } from "@/lib/falkordb";
import { SAMPLE_EDGES, SAMPLE_NODES, SAMPLE_VERSION as VERSION } from "@/lib/sample-graph-data";

export async function loadSampleGraph(graphName: string, workspaceId: string) {
  await withWorkspaceGraph(graphName, async (query) => {
    for (const [label, id, title] of SAMPLE_NODES) {
      if (!/^[A-Za-z]{1,40}$/.test(label)) continue;
      await query(`MERGE (n:${label} {source_id: $id}) SET n.id = $id, n.title = $title, n.workspace_id = $workspace_id, n.acl_role = 'workspace', n.source_version = $version, n.sample = true`,
        5000, { id, title, workspace_id: workspaceId, version: VERSION });
    }
    for (const [from, type, to] of SAMPLE_EDGES) {
      if (!/^[A-Z_]{1,40}$/.test(type)) continue;
      await query(`MATCH (a {source_id: $from, sample: true}), (b {source_id: $to, sample: true}) MERGE (a)-[e:${type} {id: $edge_id}]->(b) SET e.workspace_id = $workspace_id, e.acl_role = 'workspace', e.source_version = $version, e.sample = true`,
        5000, { from, to, edge_id: `${from}|${type}|${to}`, workspace_id: workspaceId, version: VERSION });
    }
  });
  return { nodes: SAMPLE_NODES.length, edges: SAMPLE_EDGES.length };
}

export async function clearSampleGraph(graphName: string) {
  await withWorkspaceGraph(graphName, (query) => query("MATCH (n {sample: true}) DETACH DELETE n", 5000));
}

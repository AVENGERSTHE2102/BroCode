import { NextResponse } from "next/server";
import { withWorkspaceGraph } from "@/lib/falkordb";
import { resolveWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
const acl = (entity: string) => `(${entity}.acl_role = 'workspace' OR ${entity}.acl_role = $role OR (${entity}.acl_role = 'admin' AND $role = 'owner'))`;

function parse(rows: unknown[][]) {
  return rows.flatMap((row) => {
    try { const value: unknown = typeof row[0] === "string" ? JSON.parse(row[0]) : row[0]; return value && typeof value === "object" ? [value as Record<string, unknown>] : []; }
    catch { return []; }
  });
}
const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : undefined);

// Workspace graph overview (nodes + edges the caller's role may read), bounded for rendering.
export async function GET(request: Request) {
  const access = await resolveWorkspace(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: { "Cache-Control": "no-store" } });
  const params = { role: access.workspace.role };
  try {
    const result = await withWorkspaceGraph(access.workspace.graphName, async (query) => {
      const nodeRows = await query(`MATCH (n) WHERE NOT n:ProjectionMarker AND ${acl("n")} RETURN toJSON({labels: labels(n), id: n.id, source_id: n.source_id, source_version: n.source_version, title: coalesce(n.title, n.name, n.path, n.id), url: n.source_url, sample: n.sample}) LIMIT 160`, 4000, params);
      const edgeRows = await query(`MATCH (a)-[e]->(b) WHERE ${acl("a")} AND ${acl("b")} AND ${acl("e")} RETURN toJSON({from: coalesce(a.source_id, a.id), to: coalesce(b.source_id, b.id), type: type(e)}) LIMIT 500`, 4000, params);
      return { nodeRows, edgeRows };
    });
    const nodes = parse(result.nodeRows).flatMap((node) => {
      const key = text(node.source_id, 300) ?? text(node.id, 300);
      const label = Array.isArray(node.labels) ? text(node.labels[0], 64) : undefined;
      if (!key || !label) return [];
      const url = text(node.url, 500);
      const version = text(node.source_version, 200);
      return [{ key, label, title: text(node.title, 200) ?? key, ...(version ? { version } : {}), ...(url?.startsWith("https://github.com/") ? { url } : {}), ...(node.sample === true ? { sample: true } : {}) }];
    });
    const keys = new Set(nodes.map((node) => node.key));
    const edges = parse(result.edgeRows).flatMap((edge) => {
      const from = text(edge.from, 300), to = text(edge.to, 300), type = text(edge.type, 64);
      return from && to && type && keys.has(from) && keys.has(to) ? [{ from, to, type }] : [];
    });
    return NextResponse.json({ nodes, edges, truncated: nodes.length >= 160 }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The graph database is unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

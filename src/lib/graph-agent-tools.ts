import { withWorkspaceGraph } from "@/lib/falkordb";
import { decodeGraphPathRows } from "@/lib/graph-path-display";
import { nodeInScope, parseScope, scopeCondition } from "@/lib/graph-scope";
import { resolveWorkspace } from "@/lib/workspace";

// Graph algorithms exposed as agent tools. All are read-only and filter every node and edge by the caller's role.
const acl = (entity: string) => `(${entity}.acl_role = 'workspace' OR ${entity}.acl_role = $role OR (${entity}.acl_role = 'admin' AND $role = 'owner'))`;
const NODE = (n: string) => `{labels: labels(${n}), id: ${n}.id, source_id: ${n}.source_id, source_version: ${n}.source_version, title: coalesce(${n}.title, ${n}.name, ${n}.path, ${n}.id), source_url: ${n}.source_url}`;
const PATH_RETURN = `toJSON([node IN nodes(p) | ${NODE("node")}]), toJSON([edge IN relationships(p) | {type: type(edge)}])`;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const bounded = (value: unknown, fallback: number, max: number) => (Number.isInteger(value) ? Math.max(1, Math.min(value as number, max)) : fallback);
const entityId = (value: unknown) => (typeof value === "string" && value.trim().length > 0 && value.trim().length <= 256 ? value.trim() : null);
const parseNode = (value: unknown) => { try { return typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : null; } catch { return null; } };
const bad = (error: string) => ({ ok: false as const, status: 400 as const, error });
const unavailable = { ok: false as const, status: 503 as const, error: "The graph is unavailable." };

async function withAccess<T>(request: Request, work: (graphName: string, role: string, workspaceId: string) => Promise<T>) {
  const access = await resolveWorkspace(request);
  if (!access.ok) return access;
  try { return { ok: true as const, value: await work(access.workspace.graphName, access.workspace.role, access.workspace.id) }; }
  catch { return unavailable; }
}

/** Keyword search over entity titles, names, paths and source ids — the agent's entry point when it has no exact ID. */
export async function searchEntities(request: Request, input: Record<string, unknown>) {
  const terms = typeof input.query === "string" ? [...new Set(input.query.toLowerCase().split(/[^a-z0-9._/#@-]+/).filter((term) => term.length >= 2))].slice(0, 6) : [];
  if (!terms.length) return bad("query must contain at least one keyword.");
  const label = typeof input.label === "string" && /^[A-Za-z]{1,40}$/.test(input.label) ? input.label : null;
  const limit = bounded(input.limit, 10, 25);
  const params: Record<string, string | number> = {};
  const match = terms.map((term, index) => {
    params[`t${index}`] = term;
    return `(toLower(coalesce(n.title, '')) CONTAINS $t${index} OR toLower(coalesce(n.name, '')) CONTAINS $t${index} OR toLower(coalesce(n.path, '')) CONTAINS $t${index} OR toLower(coalesce(n.source_id, '')) CONTAINS $t${index})`;
  }).join(" OR ");
  const scope = parseScope(input.scope), inScope = scopeCondition("n", scope);
  return withAccess(request, async (graph, role, workspaceId) => {
    const rows = await withWorkspaceGraph(graph, (query) => query(
      `MATCH (n${label ? `:${label}` : ""}) WHERE NOT n:ProjectionMarker AND ${acl("n")} AND ${inScope.clause} AND (${match})
       OPTIONAL MATCH (n)-[r]-() WITH n, count(r) AS degree
       RETURN toJSON(${NODE("n")}), degree ORDER BY degree DESC LIMIT $limit`, 4000, { ...params, ...inScope.params, role, limit }));
    return { workspaceId, query: terms.join(" "), data: rows.map((row) => ({ ...parseNode(row[0]), connections: Number(row[1]) || 0 })) };
  });
}

/** Shape of the graph plus its most connected entities (degree centrality): where to start an investigation. */
export async function graphOverview(request: Request, input: Record<string, unknown> = {}) {
  const scope = parseScope(input.scope), sn = scopeCondition("n", scope), sm = scopeCondition("m", scope), sa = scopeCondition("a", scope), sb = scopeCondition("b", scope);
  const scopeParams = { ...sn.params };
  return withAccess(request, async (graph, role, workspaceId) => withWorkspaceGraph(graph, async (query) => {
    const labels = await query(`MATCH (n) WHERE NOT n:ProjectionMarker AND ${acl("n")} AND ${sn.clause} RETURN labels(n)[0], count(*) ORDER BY count(*) DESC LIMIT 30`, 4000, { role, ...scopeParams });
    const relationships = await query(`MATCH (a)-[e]->(b) WHERE ${acl("e")} AND ${sa.clause} AND ${sb.clause} RETURN type(e), count(*) ORDER BY count(*) DESC LIMIT 30`, 4000, { role, ...scopeParams });
    const hubs = await query(`MATCH (n)-[r]-(m) WHERE NOT n:ProjectionMarker AND NOT n:Repository AND ${acl("n")} AND ${acl("m")} AND ${sn.clause} AND ${sm.clause}
      WITH n, count(r) AS degree RETURN toJSON(${NODE("n")}), degree ORDER BY degree DESC LIMIT 12`, 4000, { role, ...scopeParams });
    return {
      workspaceId,
      entityTypes: Object.fromEntries(labels.map((row) => [String(row[0]), Number(row[1])])),
      relationshipTypes: Object.fromEntries(relationships.map((row) => [String(row[0]), Number(row[1])])),
      mostConnected: hubs.map((row) => ({ ...parseNode(row[0]), connections: Number(row[1]) || 0 })),
    };
  }));
}

/** People connected to an entity within three hops (authored it, changed its files, own it…), ranked by number of paths. */
export async function findExperts(request: Request, input: Record<string, unknown>) {
  const id = entityId(input.entityId);
  if (!id) return bad("entityId must be 1–256 characters.");
  return withAccess(request, async (graph, role, workspaceId) => {
    const rows = await withWorkspaceGraph(graph, (query) => query(
      `MATCH (t) WHERE (t.id = $id OR t.source_id = $id) AND ${acl("t")}
       MATCH p=(person:Person)-[*1..3]-(t) WHERE all(node IN nodes(p) WHERE ${acl("node")} AND ${scopeCondition("node", parseScope(input.scope)).clause}) AND all(edge IN relationships(p) WHERE ${acl("edge")})
       RETURN ${PATH_RETURN} LIMIT 80`, 4000, { id, role, ...scopeCondition("node", parseScope(input.scope)).params }));
    const paths = decodeGraphPathRows(rows);
    const experts = new Map<string, { person: Record<string, unknown>; paths: number; shortest: number }>();
    for (const [rawNodes] of paths) { const nodes = rawNodes as Record<string, unknown>[];
      const person = (nodes as Record<string, unknown>[])[0];
      const key = String(person?.source_id ?? person?.id ?? "");
      if (!key) continue;
      const entry = experts.get(key) ?? { person, paths: 0, shortest: 99 };
      entry.paths++; entry.shortest = Math.min(entry.shortest, nodes.length - 1);
      experts.set(key, entry);
    }
    const ranked = [...experts.values()].sort((a, b) => b.paths - a.paths || a.shortest - b.shortest).slice(0, bounded(input.limit, 8, 25));
    return { workspaceId, entityId: id, experts: ranked.map((entry) => ({ ...entry.person, connectingPaths: entry.paths, hops: entry.shortest })), data: paths.slice(0, 12) };
  });
}

/** Blast radius: everything within N hops of an entity, grouped by type and distance. */
export async function impactAnalysis(request: Request, input: Record<string, unknown>) {
  const id = entityId(input.entityId);
  if (!id) return bad("entityId must be 1–256 characters.");
  const maxDepth = bounded(input.maxDepth, 2, 3);
  return withAccess(request, async (graph, role, workspaceId) => {
    const rows = await withWorkspaceGraph(graph, (query) => query(
      `MATCH p=(t)-[*1..3]-(other) WHERE (t.id = $id OR t.source_id = $id) AND length(p) <= $depth AND NOT other:ProjectionMarker
       AND all(node IN nodes(p) WHERE ${acl("node")} AND ${scopeCondition("node", parseScope(input.scope)).clause}) AND all(edge IN relationships(p) WHERE ${acl("edge")})
       RETURN ${PATH_RETURN} LIMIT 150`, 4000, { id, role, depth: maxDepth, ...scopeCondition("node", parseScope(input.scope)).params }));
    const paths = decodeGraphPathRows(rows);
    const affected = new Map<string, { entity: Record<string, unknown>; hops: number }>();
    for (const [rawNodes] of paths) { const nodes = rawNodes as Record<string, unknown>[];
      const last = (nodes as Record<string, unknown>[]).at(-1);
      const key = String(last?.source_id ?? last?.id ?? "");
      if (key && (!affected.has(key) || affected.get(key)!.hops > nodes.length - 1)) affected.set(key, { entity: last!, hops: nodes.length - 1 });
    }
    const byType: Record<string, number> = {};
    for (const { entity } of affected.values()) { const type = Array.isArray(entity.labels) ? String(entity.labels[0]) : "Entity"; byType[type] = (byType[type] ?? 0) + 1; }
    return { workspaceId, entityId: id, maxDepth, affectedCount: affected.size, byType,
      affected: [...affected.values()].sort((a, b) => a.hops - b.hops).slice(0, 30).map(({ entity, hops }) => ({ ...entity, hops })), data: paths.slice(0, 15) };
  });
}

/** Shortest connection between two entities — "how is X related to Y?". */
export async function shortestPath(request: Request, input: Record<string, unknown>) {
  const from = entityId(input.fromId), to = entityId(input.toId);
  if (!from || !to) return bad("fromId and toId must be 1–256 characters.");
  const scope = parseScope(input.scope), sa = scopeCondition("a", scope);
  return withAccess(request, async (graph, role, workspaceId) => {
    const rows = await withWorkspaceGraph(graph, (query) => query(
      `MATCH (a), (b) WHERE (a.id = $from OR a.source_id = $from) AND (b.id = $to OR b.source_id = $to) AND ${acl("a")} AND ${acl("b")} AND ${sa.clause} AND ${scopeCondition("b", scope).clause}
       WITH a, b LIMIT 1 WITH shortestPath((a)-[*..6]-(b)) AS p WHERE p IS NOT NULL
       RETURN ${PATH_RETURN}, toJSON([node IN nodes(p) | node.acl_role]), toJSON([edge IN relationships(p) | edge.acl_role])`, 4000, { from, to, role, ...sa.params }));
    const readable = (value: unknown) => value === "workspace" || value === role || (value === "admin" && role === "owner");
    const visible = rows.filter((row) => {
      try { return [...JSON.parse(String(row[2])), ...JSON.parse(String(row[3]))].every(readable); } catch { return false; }
    }).map((row) => [row[0], row[1]]);
    const paths = decodeGraphPathRows(visible).filter(([nodes]) => (nodes as Record<string, unknown>[]).every((node) => nodeInScope(node, scope)));
    return { workspaceId, fromId: from, toId: to, connected: paths.length > 0, hops: paths[0] ? (paths[0][0] as unknown[]).length - 1 : null, data: paths.slice(0, 1) };
  });
}

export function isRecordInput(value: unknown): value is Record<string, unknown> { return record(value); }

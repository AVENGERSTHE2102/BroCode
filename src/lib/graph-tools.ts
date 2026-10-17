import { withWorkspaceGraph } from "@/lib/falkordb";
import { decodeGraphPathRows } from "@/lib/graph-path-display";
import { parseScope, scopeCondition, type GraphScope } from "@/lib/graph-scope";
import { resolveWorkspace } from "@/lib/workspace";
import { workspaceSupabase } from "@/lib/workspace-supabase";

export type GraphToolResult<T> = {
  workspaceId: string;
  data: T[];
  truncated: boolean;
};

export type ResolveInput = { identifier: string; scope?: GraphScope };
export type TraceInput = { entityId: string; maxDepth?: number; limit?: number; scope?: GraphScope };

function boundedInteger(value: number | undefined, fallback: number, max: number) {
  return Number.isInteger(value) ? Math.max(1, Math.min(value as number, max)) : fallback;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const readableAcl = (entity: string) => `${entity}.acl_role = 'workspace' OR ${entity}.acl_role = $role OR (${entity}.acl_role = 'admin' AND $role = 'owner')`;

export function parseResolveInput(input: unknown): ResolveInput | null {
  if (!record(input) || typeof input.identifier !== "string") return null;
  const identifier = input.identifier.trim();
  return identifier.length > 0 && identifier.length <= 256 ? { identifier, ...(input.scope !== undefined ? { scope: parseScope(input.scope) } : {}) } : null;
}

export function parseTraceInput(input: unknown): TraceInput | null {
  if (!record(input) || typeof input.entityId !== "string") return null;
  const entityId = input.entityId.trim();
  return entityId.length > 0 && entityId.length <= 256
    ? { entityId, ...(typeof input.maxDepth === "number" ? { maxDepth: input.maxDepth } : {}), ...(typeof input.limit === "number" ? { limit: input.limit } : {}), ...(input.scope !== undefined ? { scope: parseScope(input.scope) } : {}) }
    : null;
}

export function classifyGraphMatches(matches: unknown[][], resolvedBy: "exact" | "alias") {
  if (matches.length === 1) return { data: matches, resolved: true, resolvedBy, ambiguous: false, truncated: false };
  if (matches.length > 1) return {
    data: [], candidates: matches.slice(0, 10), resolved: false, resolvedBy: null,
    ambiguous: true, truncated: matches.length > 10,
  };
  return { data: [], resolved: false, resolvedBy: null, ambiguous: false, truncated: false };
}

export async function resolveGraphEntity(request: Request, input: ResolveInput) {
  const access = await workspaceSupabase(request);
  if (!access.ok) return access;
  const parsed = parseResolveInput(input);
  if (!parsed) return { ok: false as const, status: 400 as const, error: "Identifier must be 1–256 characters." };

  let exact: unknown[][];
  try {
    exact = await withWorkspaceGraph(access.workspace.graphName, (query) => query(
      `MATCH (n) WHERE (n.id = $identifier OR n.source_id = $identifier) AND (${readableAcl("n")}) AND ${scopeCondition("n", parsed.scope ?? "all").clause} RETURN labels(n), properties(n) LIMIT $limit`,
      3000, { identifier: parsed.identifier, role: access.workspace.role, limit: 11, ...scopeCondition("n", parsed.scope ?? "all").params },
    ));
  } catch { return { ok: false as const, status: 503 as const, error: "Graph entity lookup is unavailable." }; }
  if (exact.length) {
    const result = classifyGraphMatches(exact, "exact");
    return { ok: true as const, value: { workspaceId: access.workspace.id, ...result } };
  }

  const alias = await access.supabase.from("workspace_entity_aliases").select("target_source_id")
    .eq("workspace_id", access.workspace.id).eq("normalized_alias", parsed.identifier.toLowerCase()).maybeSingle();
  if (alias.error) return { ok: false as const, status: 503 as const, error: "Workspace aliases could not be checked." };
  if (!alias.data) return { ok: true as const, value: { workspaceId: access.workspace.id, ...classifyGraphMatches([], "exact"), reason: "not_found" } };
  const targetSourceId = alias.data.target_source_id;

  try {
    const targets = await withWorkspaceGraph(access.workspace.graphName, (query) => query(
      `MATCH (n) WHERE (n.id = $identifier OR n.source_id = $identifier) AND (${readableAcl("n")}) AND ${scopeCondition("n", parsed.scope ?? "all").clause} RETURN labels(n), properties(n) LIMIT $limit`,
      3000, { identifier: targetSourceId, role: access.workspace.role, limit: 11, ...scopeCondition("n", parsed.scope ?? "all").params },
    ));
    const result = classifyGraphMatches(targets, "alias");
    return { ok: true as const, value: { workspaceId: access.workspace.id, alias: parsed.identifier, ...result, ...(!targets.length ? { reason: "alias_target_missing" } : {}) } };
  } catch { return { ok: false as const, status: 503 as const, error: "Graph alias target lookup is unavailable." }; }
}

export async function traceGraphEntity(request: Request, input: TraceInput) {
  const access = await resolveWorkspace(request);
  if (!access.ok) return access;
  const parsed = parseTraceInput(input);
  if (!parsed) return { ok: false as const, status: 400 as const, error: "Entity ID must be 1–256 characters." };
  const maxDepth = boundedInteger(parsed.maxDepth, 2, 4);
  const limit = boundedInteger(parsed.limit, 20, 50);

  const rows = await withWorkspaceGraph(access.workspace.graphName, (query) => query(
    `MATCH p=(start)-[*1..4]-(related) WHERE (start.id = $entity_id OR start.source_id = $entity_id) AND length(p) <= $max_depth AND all(node IN nodes(p) WHERE ${readableAcl("node")}) AND all(node IN nodes(p) WHERE ${scopeCondition("node", parsed.scope ?? "all").clause}) AND all(edge IN relationships(p) WHERE ${readableAcl("edge")}) RETURN toJSON([node IN nodes(p) | {labels: labels(node), id: node.id, source_id: node.source_id, source_version: node.source_version, title: coalesce(node.title, node.name, node.path, node.fact_key), source_url: node.source_url}]) AS nodes, toJSON([edge IN relationships(p) | {type: type(edge), source_id: edge.source_id, source_version: edge.source_version}]) AS relationships LIMIT $limit`,
    3000,
    { entity_id: parsed.entityId, max_depth: maxDepth, role: access.workspace.role, limit: limit + 1, ...scopeCondition("node", parsed.scope ?? "all").params },
  ));
  const data = decodeGraphPathRows(rows);
  return { ok: true as const, value: { workspaceId: access.workspace.id, data: data.slice(0, limit), truncated: data.length > limit } };
}

import { NextResponse } from "next/server";
import { findExperts, impactAnalysis } from "@/lib/graph-agent-tools";
import { graphPathsForDisplay } from "@/lib/graph-path-display";

export const runtime = "nodejs";

type RawNode = Record<string, unknown>;
type ImpactValue = { entityId: string; maxDepth: number; affectedCount: number; byType: Record<string, number>; affected: RawNode[]; data: unknown[][] };
type ExpertsValue = { experts: RawNode[] };

function normalize(entity: RawNode) {
  const key = typeof entity.source_id === "string" ? entity.source_id : entity.id !== undefined && entity.id !== null ? String(entity.id) : null;
  if (!key) return null;
  const labels = Array.isArray(entity.labels) ? entity.labels : [];
  const label = labels.find((part) => typeof part === "string") ?? "Entity";
  const title = [entity.title, entity.name, entity.path].find((part) => typeof part === "string" && part.trim());
  const hops = typeof entity.hops === "number" ? entity.hops : undefined;
  const connectingPaths = typeof entity.connectingPaths === "number" ? entity.connectingPaths : undefined;
  return {
    key: key.slice(0, 300), label: String(label).slice(0, 64), title: typeof title === "string" ? title.slice(0, 200) : key.slice(0, 200),
    ...(hops !== undefined ? { hops } : {}), ...(connectingPaths !== undefined ? { connectingPaths } : {}),
  };
}

// Blast radius: everything connected to one entity within a few hops, grouped by distance, plus who to ask
// before touching it. Read-only, so (like /api/graph/explore) this needs no same-origin check.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId") ?? "";
  const maxDepthParam = url.searchParams.get("maxDepth");
  const scope = url.searchParams.get("scope");
  const input: Record<string, unknown> = { entityId };
  if (maxDepthParam) input.maxDepth = Number(maxDepthParam);
  if (scope) input.scope = scope;

  const [impact, experts] = await Promise.all([impactAnalysis(request, input), findExperts(request, { ...input, limit: 8 })]);
  if (!impact.ok) return NextResponse.json({ error: impact.error }, { status: impact.status, headers: { "Cache-Control": "no-store" } });

  const value = impact.value as ImpactValue;
  const expertsList = experts.ok ? (experts.value as ExpertsValue).experts : [];
  return NextResponse.json({
    entityId: value.entityId,
    maxDepth: value.maxDepth,
    affectedCount: value.affectedCount,
    byType: value.byType,
    affected: value.affected.flatMap((entity) => { const normalized = normalize(entity); return normalized ? [normalized] : []; }),
    experts: expertsList.flatMap((entity) => { const normalized = normalize(entity); return normalized ? [normalized] : []; }),
    paths: graphPathsForDisplay(value.data),
  }, { headers: { "Cache-Control": "no-store" } });
}

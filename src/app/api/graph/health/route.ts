import { NextResponse } from "next/server";
import { withWorkspaceGraph } from "@/lib/falkordb";
import { resolveWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const workspaceStartedAt = performance.now();
  const access = await resolveWorkspace(request);
  if (!access.ok) return NextResponse.json({ status: "unavailable", error: access.error }, { status: access.status, headers: { "Cache-Control": "no-store" } });
  const supabase = { status: "connected", latencyMs: Math.round(performance.now() - workspaceStartedAt) };

  const startedAt = performance.now();
  try {
    const rows = await withWorkspaceGraph(access.workspace.graphName, (query) => query("RETURN 1 AS ok"));
    if (rows.length !== 1) throw new Error("Graph health query returned no row.");
    const falkordb = { status: "connected", latencyMs: Math.round(performance.now() - startedAt) };
    return NextResponse.json({ status: "connected", dependency: "falkordb", latencyMs: falkordb.latencyMs, dependencies: { supabase, falkordb } }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const code = typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
      && /^[A-Z0-9_]{1,64}$/.test(cause.code) ? cause.code : undefined;
    return NextResponse.json({
      status: "unavailable", dependency: "falkordb", latencyMs,
      dependencies: { supabase, falkordb: { status: "unavailable", latencyMs } },
      ...(code ? { errorCode: code } : {}),
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

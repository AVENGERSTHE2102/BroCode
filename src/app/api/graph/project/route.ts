import { NextResponse } from "next/server";
import { drainGraphProjection } from "@/lib/graph-projection-drain";
import { backfillGithubLinks, reprojectGithubRecords } from "@/lib/graph-projection";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSameOrigin } from "@/lib/same-origin";
import { resolveWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

// Owner/admin "refresh graph": project any synced records still waiting in the outbox into FalkorDB.
export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Request must come from this application origin." }, { status: 403 });
  const access = await resolveWorkspace(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (access.workspace.role !== "owner" && access.workspace.role !== "admin") return NextResponse.json({ error: "Workspace admin access is required." }, { status: 403 });
  try {
    const drained = await drainGraphProjection();
    const { data: rows } = await createAdminClient().from("workspace_github_records")
      .select("id, workspace_id, github_source_id, record_id, record_type, provider_version, version, payload")
      .eq("workspace_id", access.workspace.id).limit(3000);
    const repaired = rows?.length ? await reprojectGithubRecords(access.workspace.id, rows) : { reprojected: 0 };
    const backfill = await backfillGithubLinks(access.workspace.graphName, access.workspace.id);
    return NextResponse.json({ ...drained, ...repaired, ...backfill });
  }
  catch { return NextResponse.json({ error: "Graph projection is unavailable (check the graph database connection)." }, { status: 503 }); }
}

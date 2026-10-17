import { NextResponse } from "next/server";
import { clearSampleGraph, loadSampleGraph } from "@/lib/sample-graph";
import { requireSameOrigin } from "@/lib/same-origin";
import { resolveWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

async function admin(request: Request) {
  if (!requireSameOrigin(request)) return { response: NextResponse.json({ error: "Request must come from this application origin." }, { status: 403 }) };
  const access = await resolveWorkspace(request);
  if (!access.ok) return { response: NextResponse.json({ error: access.error }, { status: access.status }) };
  if (access.workspace.role !== "owner" && access.workspace.role !== "admin") return { response: NextResponse.json({ error: "Workspace admin access is required." }, { status: 403 }) };
  return { workspace: access.workspace };
}

export async function POST(request: Request) {
  const result = await admin(request);
  if (!result.workspace) return result.response;
  try { return NextResponse.json({ loaded: await loadSampleGraph(result.workspace.graphName, result.workspace.id), synthetic: true }); }
  catch { return NextResponse.json({ error: "The graph database is unavailable, so the sample could not be loaded." }, { status: 503 }); }
}

export async function DELETE(request: Request) {
  const result = await admin(request);
  if (!result.workspace) return result.response;
  try { await clearSampleGraph(result.workspace.graphName); return NextResponse.json({ cleared: true }); }
  catch { return NextResponse.json({ error: "The graph database is unavailable." }, { status: 503 }); }
}

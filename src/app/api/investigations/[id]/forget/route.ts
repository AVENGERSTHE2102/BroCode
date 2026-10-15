import { NextResponse } from "next/server";
import { workspaceSupabase } from "@/lib/workspace-supabase";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const current = await workspaceSupabase(request);
    if (!current.ok) return NextResponse.json({ error: current.error }, { status: current.status });
    if (!UUID.test(id)) return NextResponse.json({ error: "Investigation ID is invalid." }, { status: 400 });
    if (current.workspace.role !== "owner" && current.workspace.role !== "admin") {
      return NextResponse.json({ error: "Workspace administrator access is required." }, { status: 403 });
    }
    const { data, error } = await current.supabase.rpc("forget_investigation", {
      p_workspace_id: current.workspace.id,
      p_investigation_id: id,
    });
    if (error || !data) return NextResponse.json({ error: "Investigation forgetting could not be started." }, { status: 409 });
    return NextResponse.json({ request: data }, { status: 202 });
  } catch {
    return NextResponse.json({ error: "Investigation storage is unavailable." }, { status: 503 });
  }
}

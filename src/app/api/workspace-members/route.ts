import { NextResponse } from "next/server";
import { workspaceSupabase } from "@/lib/workspace-supabase";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const current = await workspaceSupabase(request);
    if (!current.ok) return NextResponse.json({ error: current.error }, { status: current.status });
    const { data, error } = await current.supabase.rpc("list_workspace_members", { p_workspace_id: current.workspace.id });
    if (error) return NextResponse.json({ error: "Workspace members could not be loaded." }, { status: 503 });
    const members = ((data ?? []) as Array<{ user_id: string; role: string }>).filter((member) => member.user_id !== current.workspace.userId);
    return NextResponse.json({ members }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Workspace members could not be loaded." }, { status: 503 });
  }
}

import { NextResponse } from "next/server";
import { workspaceSupabase } from "@/lib/workspace-supabase";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const current = await workspaceSupabase(request);
    if (!current.ok) return NextResponse.json({ error: current.error }, { status: current.status });
    if (!UUID.test(id)) return NextResponse.json({ error: "Forget request ID is invalid." }, { status: 400 });
    const { data, error } = await current.supabase.from("investigation_forget_requests")
      .select("id, status, created_at, completed_at")
      .eq("workspace_id", current.workspace.id).eq("id", id).maybeSingle();
    if (error) return NextResponse.json({ error: "Forget request status is unavailable." }, { status: 503 });
    if (!data) return NextResponse.json({ error: "Forget request was not found." }, { status: 404 });
    return NextResponse.json({ request: data });
  } catch {
    return NextResponse.json({ error: "Forget request status is unavailable." }, { status: 503 });
  }
}

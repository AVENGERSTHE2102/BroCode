import { NextResponse } from "next/server";
import { workspaceSupabase } from "@/lib/workspace-supabase";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await workspaceSupabase(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { data, error } = await access.supabase.from("workspace_github_installations")
    .select("installation_id, github_login, created_at")
    .eq("workspace_id", access.workspace.id).order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: "GitHub installations could not be loaded." }, { status: 503 });
  return NextResponse.json({ installations: data });
}

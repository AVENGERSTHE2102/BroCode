import { NextResponse } from "next/server";
import { workspaceSupabase } from "@/lib/workspace-supabase";
import { requireSameOrigin } from "@/lib/same-origin";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ aliasId: string }> }) {
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Alias removal must be requested from this application origin." }, { status: 403 });
  const access = await workspaceSupabase(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!["owner", "admin"].includes(access.workspace.role)) return NextResponse.json({ error: "Workspace admin access is required." }, { status: 403 });
  const { aliasId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(aliasId)) {
    return NextResponse.json({ error: "Alias ID is invalid." }, { status: 400 });
  }
  const { data, error } = await access.supabase.from("workspace_entity_aliases").delete()
    .eq("workspace_id", access.workspace.id).eq("id", aliasId).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: "Alias could not be removed." }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Alias was not found in this workspace." }, { status: 404 });
  return NextResponse.json({ removed: true });
}

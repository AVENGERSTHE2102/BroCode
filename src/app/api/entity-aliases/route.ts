import { NextResponse } from "next/server";
import { withWorkspaceGraph } from "@/lib/falkordb";
import { createAdminClient } from "@/lib/supabase/admin";
import { workspaceSupabase } from "@/lib/workspace-supabase";
import { readJsonBody } from "@/lib/read-json-body";
import { requireSameOrigin } from "@/lib/same-origin";

export const runtime = "nodejs";
const isAdmin = (role: string) => role === "owner" || role === "admin";

export async function GET(request: Request) {
  const access = await workspaceSupabase(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { data, error } = await access.supabase.from("workspace_entity_aliases")
    .select("id, alias, target_source_id, created_at").eq("workspace_id", access.workspace.id)
    .order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "Workspace aliases could not be loaded." }, { status: 503 });
  return NextResponse.json({ aliases: data });
}

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Aliases must be requested from this application origin." }, { status: 403 });
  const access = await workspaceSupabase(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!isAdmin(access.workspace.role)) return NextResponse.json({ error: "Workspace admin access is required." }, { status: 403 });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
  const parsed = await readJsonBody(request, 4096);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === "too_large" ? "Request body is too large." : "Request body must be valid JSON." }, { status: parsed.reason === "too_large" ? 413 : 400 });
  const body = parsed.value;
  if (typeof body !== "object" || body === null || Array.isArray(body)) return NextResponse.json({ error: "Alias input is invalid." }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (typeof input.alias !== "string" || input.alias.trim().length < 2 || input.alias.trim().length > 128
    || !/^[A-Za-z0-9._:/ -]+$/.test(input.alias) || typeof input.targetIdentifier !== "string"
    || input.targetIdentifier.trim().length < 1 || input.targetIdentifier.trim().length > 256) {
    return NextResponse.json({ error: "Alias and exact target identifier are required." }, { status: 400 });
  }
  const targetIdentifier = input.targetIdentifier as string;

  let matches: unknown[][];
  try {
    matches = await withWorkspaceGraph(access.workspace.graphName, (query) => query(
      "MATCH (n) WHERE (n.id = $identifier OR n.source_id = $identifier) AND (n.acl_role = 'workspace' OR n.acl_role = $role) RETURN n.source_id, n.id LIMIT 2",
      3000, { identifier: targetIdentifier.trim(), role: access.workspace.role },
    ));
  } catch { return NextResponse.json({ error: "Target entity could not be verified." }, { status: 503 }); }
  if (matches.length > 1) return NextResponse.json({ error: "Target identifier is ambiguous; no alias was created." }, { status: 409 });
  const targetSourceId = matches[0]?.find((value) => typeof value === "string");
  if (typeof targetSourceId !== "string") return NextResponse.json({ error: "Target entity was not found in this workspace." }, { status: 404 });

  try {
    const { data, error } = await createAdminClient().rpc("create_workspace_entity_alias", {
      p_workspace_id: access.workspace.id, p_user_id: access.workspace.userId,
      p_alias: input.alias.trim(), p_target_source_id: targetSourceId,
    });
    if (error) return NextResponse.json({ error: error.code === "23505" ? "That alias is already assigned in this workspace." : "Alias could not be saved." }, { status: error.code === "23505" ? 409 : 503 });
    return NextResponse.json({ alias: data }, { status: 201 });
  } catch { return NextResponse.json({ error: "Alias could not be saved." }, { status: 503 }); }
}

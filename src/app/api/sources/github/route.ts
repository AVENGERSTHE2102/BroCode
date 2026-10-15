import { NextResponse } from "next/server";
import { verifyGitHubRepositoryAccess } from "@/lib/github-app";
import { createAdminClient } from "@/lib/supabase/admin";
import { workspaceSupabase } from "@/lib/workspace-supabase";
import { readJsonBody } from "@/lib/read-json-body";

export const runtime = "nodejs";
type GitHubSourceRow = { id: string; repository_id: number; full_name: string; html_url: string; default_branch: string; provider_updated_at: string | null; created_at: string };

export async function GET(request: Request) {
  const access = await workspaceSupabase(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { data, error } = await access.supabase.from("workspace_github_sources")
    .select("id, repository_id, full_name, html_url, default_branch, provider_updated_at, created_at")
    .eq("workspace_id", access.workspace.id).order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: "GitHub sources could not be loaded." }, { status: 503 });
  let syncStates: Array<Record<string, unknown>> = [];
  if (["owner", "admin"].includes(access.workspace.role) && data?.length) {
    try {
      const result = await access.supabase.from("workspace_github_sync_state")
        .select("github_source_id, run_id, started_at, completed_at, status, counts, changed_records, partial_errors, error_code")
        .eq("workspace_id", access.workspace.id).in("github_source_id", data.map((source) => source.id));
      if (result.error) return NextResponse.json({ error: "GitHub sync status could not be loaded." }, { status: 503 });
      syncStates = result.data as Array<Record<string, unknown>>;
    } catch { return NextResponse.json({ error: "GitHub sync status could not be loaded." }, { status: 503 }); }
  }
  const bySource = new Map(syncStates.map((state) => [String(state.github_source_id), state]));
  return NextResponse.json({ sources: (data as GitHubSourceRow[]).map((source) => ({
    ...source, last_sync: bySource.get(source.id) ?? null,
  })) });
}

export async function POST(request: Request) {
  const access = await workspaceSupabase(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!['owner', 'admin'].includes(access.workspace.role)) return NextResponse.json({ error: "Workspace admin access is required." }, { status: 403 });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
  const parsed = await readJsonBody(request, 4096);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === "too_large" ? "Request body is too large." : "Request body must be valid JSON." }, { status: parsed.reason === "too_large" ? 413 : 400 });
  const body = parsed.value;
  if (typeof body !== "object" || body === null || Array.isArray(body)) return NextResponse.json({ error: "GitHub source selection is invalid." }, { status: 400 });
  const input = body as Record<string, unknown>;
  const installationId = input.installationId;
  const repositoryId = input.repositoryId;
  const fullName = input.fullName;
  if (!Number.isSafeInteger(installationId) || Number(installationId) < 1 || !Number.isSafeInteger(repositoryId)
    || Number(repositoryId) < 1 || typeof fullName !== "string" || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(fullName)) {
    return NextResponse.json({ error: "A valid installation and repository selection are required." }, { status: 400 });
  }

  const binding = await access.supabase.from("workspace_github_installations").select("installation_id")
    .eq("workspace_id", access.workspace.id).eq("installation_id", installationId).maybeSingle();
  if (binding.error) return NextResponse.json({ error: "GitHub installation authorization could not be checked." }, { status: 503 });
  if (!binding.data) return NextResponse.json({ error: "This GitHub installation is not authorized for the selected workspace." }, { status: 404 });

  let repository;
  try { repository = await verifyGitHubRepositoryAccess(installationId as number, repositoryId as number, fullName); }
  catch { return NextResponse.json({ error: "GitHub could not verify this repository with the required read-only permissions." }, { status: 502 }); }

  try {
    const { data, error } = await createAdminClient().rpc("create_workspace_github_source", {
      p_workspace_id: access.workspace.id, p_user_id: access.workspace.userId,
      p_installation_id: installationId, p_repository_id: repository.id,
      p_full_name: repository.fullName, p_html_url: repository.url,
      p_default_branch: repository.defaultBranch, p_provider_updated_at: repository.updatedAt,
    });
    if (error) return NextResponse.json({ error: error.code === "23505" ? "This repository is already connected to the workspace." : "GitHub source could not be saved." }, { status: error.code === "23505" ? 409 : 503 });
    return NextResponse.json({ source: data as GitHubSourceRow }, { status: 201 });
  } catch { return NextResponse.json({ error: "GitHub source could not be saved." }, { status: 503 }); }
}

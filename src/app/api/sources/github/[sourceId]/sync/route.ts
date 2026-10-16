import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readGitHubRepositorySnapshot } from "@/lib/github-app";
import { toGitHubImportRecords, toGitHubSecurityImportRecords, type GitHubSourceForImport } from "@/lib/github-source-import";
import { readJsonBody } from "@/lib/read-json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { workspaceSupabase } from "@/lib/workspace-supabase";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const access = await workspaceSupabase(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!["owner", "admin"].includes(access.workspace.role)) return NextResponse.json({ error: "Workspace admin access is required." }, { status: 403 });
  const rateLimit = await access.supabase.rpc("check_workspace_rate_limit", {
    p_workspace_id: access.workspace.id, p_bucket: "github_sync", p_limit: 5, p_window_seconds: 60,
  });
  if (rateLimit.error) return NextResponse.json({ error: "Rate limit could not be checked." }, { status: 503 });
  if (rateLimit.data !== true) return NextResponse.json({ error: "Too many sync requests; wait a minute and try again." }, { status: 429 });
  const { sourceId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceId)) {
    return NextResponse.json({ error: "GitHub source ID is invalid." }, { status: 400 });
  }
  const parsedBody = await readJsonBody(request, 256);
  const fullResync = parsedBody.ok && parsedBody.value && typeof parsedBody.value === "object" && "fullResync" in parsedBody.value
    && (parsedBody.value as { fullResync?: unknown }).fullResync === true;
  const { data, error } = await access.supabase.from("workspace_github_sources")
    .select("id, installation_id, repository_id, full_name, html_url, default_branch, provider_updated_at, last_synced_at, last_synced_commit_sha")
    .eq("workspace_id", access.workspace.id).eq("id", sourceId).maybeSingle();
  if (error) return NextResponse.json({ error: "GitHub source could not be loaded." }, { status: 503 });
  if (!data) return NextResponse.json({ error: "GitHub source was not found in this workspace." }, { status: 404 });
  const source: GitHubSourceForImport = {
    workspaceId: access.workspace.id, sourceId: data.id, repositoryId: Number(data.repository_id),
    fullName: data.full_name, htmlUrl: data.html_url, defaultBranch: data.default_branch,
    providerUpdatedAt: data.provider_updated_at,
  };

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); }
  catch { return NextResponse.json({ error: "GitHub sync could not be started." }, { status: 503 }); }
  const runId = randomUUID();
  let didStart = false;
  try {
    const started = await admin.rpc("begin_workspace_github_sync", {
      p_workspace_id: access.workspace.id, p_source_id: source.sourceId,
      p_user_id: access.workspace.userId, p_run_id: runId,
    });
    didStart = !started.error && started.data === true;
  } catch {}
  if (!didStart) return NextResponse.json({ error: "GitHub sync could not be started." }, { status: 503 });
  const finishSync = async (status: "succeeded" | "partial" | "failed", counts: Record<string, number>, changedRecords: number, partialErrors: string[], errorCode: "provider_error" | "storage_error" | "sync_error" | null, syncedCommitSha: string | null = null) => {
    try {
      const result = await admin.rpc("finish_workspace_github_sync", {
        p_workspace_id: access.workspace.id, p_source_id: source.sourceId, p_run_id: runId,
        p_status: status, p_counts: counts, p_changed_records: changedRecords,
        p_partial_errors: partialErrors, p_error_code: errorCode, p_synced_commit_sha: syncedCommitSha,
      });
      return !result.error && result.data === true;
    } catch { return false; }
  };

  let snapshot;
  try {
    snapshot = await readGitHubRepositorySnapshot(Number(data.installation_id), source.repositoryId, source.fullName, {
      since: fullResync ? null : data.last_synced_at,
      previousCommitSha: fullResync ? null : data.last_synced_commit_sha,
    });
  } catch {
    await finishSync("failed", {}, 0, [], "provider_error");
    return NextResponse.json({ error: "GitHub repository metadata could not be imported." }, { status: 502 });
  }
  const capturedAt = new Date().toISOString();
  const counts = snapshot.items.reduce((result, item) => ({ ...result, [item.kind]: result[item.kind] + 1 }),
    { commit: 0, issue: 0, pull_request: 0, file: 0, check_run: 0, security_finding: 0 });
  try {
    const records = toGitHubImportRecords(source, snapshot.items, capturedAt);
    const securityRecords = toGitHubSecurityImportRecords(source, snapshot.items, capturedAt);
    const result = await admin.rpc("sync_workspace_github_records", {
      p_workspace_id: access.workspace.id, p_user_id: access.workspace.userId,
      p_source_id: source.sourceId, p_records: records,
    });
    if (result.error) {
      await finishSync("failed", counts, 0, [], "storage_error");
      return NextResponse.json({ error: "Imported metadata could not be saved for graph projection." }, { status: 503 });
    }
    let changedRecords = Number(result.data ?? 0);
    const partialErrors = snapshot.partialErrors.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .slice(0, 18).map((value) => value.slice(0, 500));
    if (snapshot.partialErrors.length > 18) partialErrors.push("Additional partial import warnings were omitted.");
    if (securityRecords.length) {
      try {
        const securityResult = await admin.rpc("sync_workspace_github_security_findings", {
          p_workspace_id: access.workspace.id, p_user_id: access.workspace.userId,
          p_source_id: source.sourceId, p_records: securityRecords,
        });
        if (securityResult.error) partialErrors.push("Dependabot findings could not be saved; repository records were imported.");
        else changedRecords += Number(securityResult.data ?? 0);
      } catch { partialErrors.push("Dependabot findings could not be saved; repository records were imported."); }
    }
    const status = partialErrors.length ? "partial" : "succeeded";
    const statusRecorded = await finishSync(status, counts, changedRecords, partialErrors, null, snapshot.headCommitSha);
    return NextResponse.json({
      sourceId: source.sourceId, repository: snapshot.fullName, capturedAt,
      counts, changedRecords, projection: "queued", partialErrors, status, incremental: snapshot.incremental,
      ...(statusRecorded ? {} : { statusWarning: "Sync data was imported but its latest status could not be recorded." }),
    });
  } catch {
    await finishSync("failed", counts, 0, [], "sync_error");
    return NextResponse.json({ error: "Imported metadata could not be saved for graph projection." }, { status: 503 });
  }
}

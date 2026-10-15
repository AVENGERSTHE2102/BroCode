import { NextResponse } from "next/server";
import { listGitHubInstallationRepositories } from "@/lib/github-app";
import { workspaceSupabase } from "@/lib/workspace-supabase";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await workspaceSupabase(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!['owner', 'admin'].includes(access.workspace.role)) return NextResponse.json({ error: "Workspace admin access is required." }, { status: 403 });
  const rawId = new URL(request.url).searchParams.get("installationId");
  const installationId = rawId && /^\d{1,16}$/.test(rawId) ? Number(rawId) : NaN;
  if (!Number.isSafeInteger(installationId) || installationId < 1) return NextResponse.json({ error: "A valid GitHub installation ID is required." }, { status: 400 });
  const binding = await access.supabase.from("workspace_github_installations").select("installation_id")
    .eq("workspace_id", access.workspace.id).eq("installation_id", installationId).maybeSingle();
  if (binding.error) return NextResponse.json({ error: "GitHub installation authorization could not be checked." }, { status: 503 });
  if (!binding.data) return NextResponse.json({ error: "This GitHub installation is not authorized for the selected workspace." }, { status: 404 });
  try {
    const result = await listGitHubInstallationRepositories(installationId);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "GitHub installation could not be verified. Check the App credentials, installation ID, and read-only metadata permission." }, { status: 502 });
  }
}

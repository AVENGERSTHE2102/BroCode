import { NextResponse } from "next/server";
import { describeGitHubAppSetup } from "@/lib/github-link";
import { workspaceSupabase } from "@/lib/workspace-supabase";

export const runtime = "nodejs";

// Owner/admin diagnostic: what is configured, what GitHub reports for the App, and the exact URL to register.
export async function GET(request: Request) {
  const access = await workspaceSupabase(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!["owner", "admin"].includes(access.workspace.role)) return NextResponse.json({ error: "Workspace admin access is required." }, { status: 403 });
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${protocol}://${host}` : new URL(request.url).origin;
  const { count } = await access.supabase.from("workspace_github_installations").select("installation_id", { count: "exact", head: true }).eq("workspace_id", access.workspace.id);
  const setup = await describeGitHubAppSetup();
  return NextResponse.json({ ...setup, callbackUrl: `${origin}/api/sources/github/callback`, boundInstallations: count ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}

import { NextResponse } from "next/server";
import { createGitHubInstallState } from "@/lib/github-app";
import { workspaceSupabase } from "@/lib/workspace-supabase";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const access = await workspaceSupabase(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!['owner', 'admin'].includes(access.workspace.role)) return NextResponse.json({ error: "Workspace admin access is required." }, { status: 403 });
  const slug = process.env.GITHUB_APP_SLUG;
  const secret = process.env.GITHUB_APP_STATE_SECRET;
  if (!slug || !/^[a-z0-9-]{1,100}$/i.test(slug) || !secret) return NextResponse.json({ error: "GitHub App installation is not configured." }, { status: 503 });
  let state;
  try { state = createGitHubInstallState(access.workspace.id, access.workspace.userId, secret); }
  catch { return NextResponse.json({ error: "GitHub App installation is not configured." }, { status: 503 }); }
  const installUrl = new URL(`https://github.com/apps/${slug}/installations/new`);
  installUrl.searchParams.set("state", state.state);
  const response = NextResponse.json({ installUrl: installUrl.toString() });
  response.cookies.set("waypoint_github_install_nonce", state.nonce, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/sources/github/callback", maxAge: 600,
  });
  return response;
}

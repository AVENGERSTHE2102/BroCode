import { NextResponse } from "next/server";
import { createGitHubInstallState } from "@/lib/github-app";
import { workspaceSupabase } from "@/lib/workspace-supabase";
import { requireSameOrigin } from "@/lib/same-origin";
import { readJsonBody } from "@/lib/read-json-body";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "GitHub installation must be requested from this application origin." }, { status: 403 });
  const access = await workspaceSupabase(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!['owner', 'admin'].includes(access.workspace.role)) return NextResponse.json({ error: "Workspace admin access is required." }, { status: 403 });
  const slug = process.env.GITHUB_APP_SLUG;
  const secret = process.env.GITHUB_APP_STATE_SECRET;
  if (!slug || !/^[a-z0-9-]{1,100}$/i.test(slug) || !secret) return NextResponse.json({ error: "GitHub App installation is not configured." }, { status: 503 });
  let state;
  try { state = createGitHubInstallState(access.workspace.id, access.workspace.userId, secret); }
  catch { return NextResponse.json({ error: "GitHub App installation is not configured." }, { status: 503 }); }
  let mode = "install";
  const parsed = await readJsonBody(request, 1024);
  if (parsed.ok && typeof parsed.value === "object" && parsed.value !== null && (parsed.value as Record<string, unknown>).mode === "link") mode = "link";
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  if (mode === "link" && !clientId) return NextResponse.json({ error: "GitHub App client ID is not configured." }, { status: 503 });
  // "link" signs the user in with GitHub and binds installations they already have; it needs no install-redirect settings.
  const installUrl = mode === "link" ? new URL("https://github.com/login/oauth/authorize") : new URL(`https://github.com/apps/${slug}/installations/new`);
  if (mode === "link") {
    installUrl.searchParams.set("client_id", clientId!);
    // No redirect_uri: GitHub uses the App's registered Callback URL, so a host/port mismatch can never be sent.
  }
  installUrl.searchParams.set("state", state.state);
  const response = NextResponse.json({ installUrl: installUrl.toString() });
  response.cookies.set("waypoint_github_install_nonce", state.nonce, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/sources/github/callback", maxAge: 600,
  });
  return response;
}

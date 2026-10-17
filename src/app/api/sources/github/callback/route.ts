import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authorizeGitHubInstallation, verifyGitHubInstallState } from "@/lib/github-app";
import { authorizeGitHubUserInstallations } from "@/lib/github-link";
import { createAdminClient } from "@/lib/supabase/admin";
import { workspaceSupabase } from "@/lib/workspace-supabase";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Redirect back to the address the browser used (the dev port may differ from NEXT_PUBLIC_SITE_URL).
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const siteOrigin = host ? `${protocol}://${host}` : new URL(process.env.NEXT_PUBLIC_SITE_URL ?? url.origin).origin;
  const response = (status: "connected" | "error", reason?: string) => {
    const result = NextResponse.redirect(new URL(`/?github=${status}${reason ? `&reason=${reason}` : ""}`, siteOrigin));
    result.cookies.set("waypoint_github_install_nonce", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/sources/github/callback", maxAge: 0 });
    return result;
  };
  const params = url.searchParams;
  const code = params.get("code");
  const stateToken = params.get("state");
  const installationId = params.get("installation_id");
  // Two entry points: GitHub's install redirect (installation_id + setup_action), or "link" (plain OAuth code) for an already-installed App.
  const linkOnly = Boolean(code && stateToken && !installationId && !params.get("setup_action"));
  if (!code || !stateToken) return response("error", "missing_code");
  if (!linkOnly && (!installationId || !/^\d{1,16}$/.test(installationId) || !["install", "update"].includes(params.get("setup_action") ?? ""))) return response("error", "bad_redirect");
  const nonce = (await cookies()).get("waypoint_github_install_nonce")?.value ?? "";
  const state = verifyGitHubInstallState(stateToken, nonce, process.env.GITHUB_APP_STATE_SECRET ?? "");
  if (!state) return response("error", "state_expired");

  const access = await workspaceSupabase(request);
  if (!access.ok || !['owner', 'admin'].includes(access.workspace.role)
    || access.workspace.id !== state.workspaceId || access.workspace.userId !== state.userId) return response("error", "not_admin");
  const bind = (installation: number, githubUserId: number, githubLogin: string) => createAdminClient().rpc("bind_workspace_github_installation", {
    p_workspace_id: access.workspace.id, p_user_id: access.workspace.userId,
    p_installation_id: installation, p_github_user_id: githubUserId, p_github_login: githubLogin,
  });
  if (linkOnly) {
    try {
      const linked = await authorizeGitHubUserInstallations(code);
      if (!linked.installationIds.length) return response("error", "no_installation");
      for (const id of linked.installationIds) {
        const { error } = await bind(id, linked.githubUserId, linked.githubLogin);
        if (error) return response("error", "bind_failed");
      }
      return response("connected");
    } catch { return response("error", "oauth_failed"); }
  }
  try {
    const verified = await authorizeGitHubInstallation(params.get("code")!, Number(installationId));
    const { error } = await bind(verified.installationId, verified.githubUserId, verified.githubLogin);
    if (error) return response("error", "bind_failed");
    return response("connected");
  } catch { return response("error", "oauth_failed"); }
}

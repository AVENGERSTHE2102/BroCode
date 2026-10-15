import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authorizeGitHubInstallation, verifyGitHubInstallState } from "@/lib/github-app";
import { createAdminClient } from "@/lib/supabase/admin";
import { workspaceSupabase } from "@/lib/workspace-supabase";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const siteOrigin = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? url.origin).origin;
  const response = (status: "connected" | "error") => {
    const result = NextResponse.redirect(new URL(`/?github=${status}`, siteOrigin));
    result.cookies.set("waypoint_github_install_nonce", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/sources/github/callback", maxAge: 0 });
    return result;
  };
  const params = url.searchParams;
  const code = params.get("code");
  const stateToken = params.get("state");
  const installationId = params.get("installation_id");
  if (!code || !stateToken || !installationId || !/^\d{1,16}$/.test(installationId) || !["install", "update"].includes(params.get("setup_action") ?? "")) return response("error");
  const nonce = (await cookies()).get("waypoint_github_install_nonce")?.value ?? "";
  const state = verifyGitHubInstallState(stateToken, nonce, process.env.GITHUB_APP_STATE_SECRET ?? "");
  if (!state) return response("error");

  const access = await workspaceSupabase(request);
  if (!access.ok || !['owner', 'admin'].includes(access.workspace.role)
    || access.workspace.id !== state.workspaceId || access.workspace.userId !== state.userId) return response("error");
  try {
    const verified = await authorizeGitHubInstallation(params.get("code")!, Number(installationId));
    const admin = createAdminClient();
    const { error } = await admin.rpc("bind_workspace_github_installation", {
      p_workspace_id: access.workspace.id, p_user_id: access.workspace.userId,
      p_installation_id: verified.installationId, p_github_user_id: verified.githubUserId,
      p_github_login: verified.githubLogin,
    });
    if (error) return response("error");
    return response("connected");
  } catch { return response("error"); }
}

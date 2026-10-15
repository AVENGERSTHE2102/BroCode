import { cookies } from "next/headers";
import { createClient, getRequestAccessToken } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WorkspaceContext = {
  id: string;
  name: string;
  role: "owner" | "admin" | "member";
  graphName: string;
  userId: string;
};

export type WorkspaceResolution =
  | { ok: true; workspace: WorkspaceContext }
  | { ok: false; status: 401 | 409 | 503; error: string };

export async function resolveWorkspace(request?: Request): Promise<WorkspaceResolution> {
  const credential = getRequestAccessToken(request);
  if (!credential.ok) return { ok: false, status: 401, error: "A valid bearer token is required." };

  let supabase;
  try {
    supabase = await createClient(credential.token);
  } catch {
    return { ok: false, status: 503, error: "Workspace authentication is not configured." };
  }

  let claimsResult;
  try {
    claimsResult = await supabase.auth.getClaims(credential.token);
  } catch {
    return { ok: false, status: 503, error: "Workspace authentication could not be checked." };
  }
  const { data: claimsData, error: claimsError } = claimsResult;
  const userId = claimsData?.claims?.sub;
  if (claimsError || typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
    return { ok: false, status: 401, error: "Sign in to access a workspace." };
  }

  let requestedWorkspace = request?.headers.get("x-waypoint-workspace") ?? null;
  if (!requestedWorkspace) {
    try {
      requestedWorkspace = (await cookies()).get("waypoint-workspace")?.value ?? null;
    } catch {
      return { ok: false, status: 503, error: "Workspace selection could not be loaded." };
    }
  }
  if (requestedWorkspace && !UUID_PATTERN.test(requestedWorkspace)) {
    return { ok: false, status: 409, error: "The selected workspace is invalid." };
  }

  try {
    let query = supabase.from("workspace_memberships").select("workspace_id, role, workspaces!inner(name)").eq("user_id", userId);
    if (requestedWorkspace) query = query.eq("workspace_id", requestedWorkspace);
    const { data, error } = await query.order("joined_at", { ascending: true }).limit(1).maybeSingle();
    if (error) return { ok: false, status: 503, error: "Workspace membership could not be checked." };
    if (!data) return { ok: false, status: 409, error: "Create or select a workspace to continue." };

    const workspaceName = (data.workspaces as unknown as { name: string }).name;
    const id = data.workspace_id;
    return {
      ok: true,
      workspace: {
        id,
        name: workspaceName,
        role: data.role as WorkspaceContext["role"],
        graphName: `wp_${id.replaceAll("-", "")}`,
        userId,
      },
    };
  } catch {
    return { ok: false, status: 503, error: "Workspace membership could not be checked." };
  }
}

import { createClient, getRequestAccessToken } from "@/lib/supabase/server";
import { resolveWorkspace } from "@/lib/workspace";

export async function workspaceSupabase(request: Request) {
  const access = await resolveWorkspace(request);
  if (!access.ok) return access;
  const credential = getRequestAccessToken(request);
  if (!credential.ok) return { ok: false as const, status: 401 as const, error: "A valid bearer token is required." };
  try {
    return { ok: true as const, workspace: access.workspace, supabase: await createClient(credential.token) };
  } catch {
    return { ok: false as const, status: 503 as const, error: "Workspace database is not configured." };
  }
}

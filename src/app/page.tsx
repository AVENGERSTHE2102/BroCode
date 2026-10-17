import { redirect } from "next/navigation";
import { signOut } from "@/app/login/sign-out";
import { resolveWorkspace } from "@/lib/workspace";
import { withWorkspaceGraph } from "@/lib/falkordb";
import { InvestigationsPanel } from "@/app/investigations-panel";
import { GitHubSourcePanel } from "@/app/github-source-panel";
import { EntityAliasPanel } from "@/app/entity-alias-panel";
import { ChatShell } from "@/components/chat-shell";
import { Landing } from "@/components/landing";

export const dynamic = "force-dynamic";

export default async function WorkspaceHome() {
  const access = await resolveWorkspace();
  if (!access.ok && access.status === 401) return <Landing />;
  if (!access.ok && access.status === 409) redirect("/setup");
  if (!access.ok) {
    return <main className="workspace-page"><section className="workspace-card"><h1>Waypoint is not configured</h1><p>{access.error} Add the managed Supabase settings and apply the workspace migration.</p></section></main>;
  }

  let graphStatus = "unavailable";
  try {
    await withWorkspaceGraph(access.workspace.graphName, (query) => query("RETURN 1 AS ok"));
    graphStatus = "connected";
  } catch {
    graphStatus = "unavailable";
  }

  const canManage = access.workspace.role === "owner" || access.workspace.role === "admin";
  return (
    <ChatShell
      workspaceName={access.workspace.name}
      role={access.workspace.role}
      graphStatus={graphStatus}
      canManage={canManage}
      signOut={signOut}
      sources={<><GitHubSourcePanel canManage={canManage} /><EntityAliasPanel canManage={canManage} /></>}
      investigations={<InvestigationsPanel />}
    />
  );
}

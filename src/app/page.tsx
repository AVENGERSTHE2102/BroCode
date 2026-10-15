import { redirect } from "next/navigation";
import { signOut } from "@/app/login/sign-out";
import { resolveWorkspace } from "@/lib/workspace";
import { withWorkspaceGraph } from "@/lib/falkordb";
import { InvestigationsPanel } from "@/app/investigations-panel";
import { GitHubSourcePanel } from "@/app/github-source-panel";
import { EntityAliasPanel } from "@/app/entity-alias-panel";
import { WorkspaceAskPanel } from "@/app/workspace-ask-panel";

export const dynamic = "force-dynamic";

export default async function WorkspaceHome() {
  const access = await resolveWorkspace();
  if (!access.ok && access.status === 401) redirect("/login");
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

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <div className="brand"><span className="brand-mark">w</span><span>waypoint<span className="brand-dot">.</span></span></div>
        <form action={signOut}><button className="quiet-button" type="submit">Sign out</button></form>
      </header>
      <section className="workspace-card">
        <div className="eyebrow">ENGINEERING WORKSPACE</div>
        <h1>{access.workspace.name}</h1>
        <p>Your account has <strong>{access.workspace.role}</strong> access. Graph access is resolved from your verified membership on the server.</p>
        <div className="connection-row"><span className={`connection-dot ${graphStatus}`} />FalkorDB Cloud <strong>{graphStatus}</strong></div>
      </section>
      <WorkspaceAskPanel />
      <GitHubSourcePanel canManage={access.workspace.role === "owner" || access.workspace.role === "admin"} />
      <EntityAliasPanel canManage={access.workspace.role === "owner" || access.workspace.role === "admin"} />
      <section className="workspace-card next-step">
        <div className="eyebrow">CONNECTED ENGINEERING CONTEXT</div>
        <h2>Connect an operational source</h2>
        <p>GitHub repositories can be authorized above. Connect a deployed service to investigate incidents with real evidence. This workspace does not contain demo records.</p>
      </section>
      <section className="workspace-card">
        <div className="eyebrow">INVESTIGATION WORKFLOW</div>
        <h2>Investigations</h2>
        <p>Create a durable investigation, then inspect its facts, prior attempts, events, and action proposals.</p>
        <InvestigationsPanel />
      </section>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { FolderOpen, History, LayoutDashboard, LogOut, MessageSquarePlus, Network, X } from "lucide-react";
import { WorkspaceAskPanel } from "@/app/workspace-ask-panel";
import { GraphExplorer, type GraphActivity, type Raw } from "@/components/graph-explorer";
import { workflowDomainLabel, type WorkflowDomain } from "@/lib/workflow-domains";

type Recent = { id: string; title: string; workflow_domain: WorkflowDomain };
type View = "cockpit" | "sources" | "investigations";
const GITHUB_REASONS: Record<string, string> = {
  state_expired: "The link expired or was started in another browser — try again from this page.",
  not_admin: "Only a workspace owner or admin can link GitHub.",
  oauth_failed: "GitHub rejected the sign-in (check the Client ID/secret and that the Callback URL matches this address).",
  no_installation: "Your GitHub account has no installation of this App — use “Install on more repositories”.",
  bad_redirect: "GitHub returned without the install details — enable “Request user authorization (OAuth) during installation” or use “Link my existing installation”.",
  bind_failed: "The installation could not be saved to the workspace.",
  missing_code: "GitHub did not send an authorization code — check the App’s Callback URL.",
};
// Turn the most connected entities of each kind into questions that need a graph walk to answer.
function startersFrom(raw: Raw) {
  const degree = new Map<string, number>();
  for (const edge of raw.edges) { degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1); degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1); }
  const top = (label: string) => raw.nodes.filter((node) => node.label === label).sort((a, b) => (degree.get(b.key) ?? 0) - (degree.get(a.key) ?? 0))[0];
  const short = (title: string) => (title.length > 48 ? `${title.slice(0, 46)}…` : title);
  const incident = top("Incident"), service = top("Service"), file = top("File"), person = top("Person"), pr = top("PullRequest"), repo = top("Repository");
  return [
    incident && `Why did "${short(incident.title)}" happen, what was already tried, and who should fix it?`,
    service && `What is affected if ${short(service.title)} goes down?`,
    file && `Who knows the most about ${short(file.title)}?`,
    pr && `What did ${short(pr.title)} change, and what does it connect to?`,
    person && `What has ${short(person.title)} worked on, and how is it connected?`,
    repo && !incident && `Give me an overview of ${short(repo.title)}: the most connected parts and who works on them.`,
  ].filter((value): value is string => Boolean(value)).slice(0, 4);
}

const IDLE: GraphActivity = { nodes: new Set(), edges: new Set(), running: false };

// Signed-in "mission control": the live knowledge graph is the stage, the agent docks beside it and lights up its path.
export function ChatShell({ workspaceName, role, graphStatus, canManage, signOut, sources, investigations }: {
  workspaceName: string; role: string; graphStatus: string; canManage: boolean; signOut: () => Promise<void>; sources: ReactNode; investigations: ReactNode;
}) {
  const [view, setView] = useState<View>("cockpit");
  const [chatKey, setChatKey] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [activity, setActivity] = useState<GraphActivity>(IDLE);
  const [githubNotice, setGithubNotice] = useState<"connected" | "error" | null>(null);
  const [githubReason, setGithubReason] = useState("");
  const [scope, setScope] = useState<{ value: string; label: string }>({ value: "all", label: "All sources" });
  const [starters, setStarters] = useState<string[]>([]);
  const onGraphLoaded = useCallback((raw: Raw) => setStarters(startersFrom(raw)), []);
  const [prefill, setPrefill] = useState<{ text: string; n: number } | undefined>();

  const loadRecent = useCallback(() => {
    fetch("/api/investigations", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { investigations?: Recent[] } | null) => { if (body?.investigations) setRecent(body.investigations.slice(0, 12)); })
      .catch(() => undefined);
  }, []);
  useEffect(loadRecent, [loadRecent]);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const status = query.get("github");
    if (status === "connected" || status === "error") {
      setGithubNotice(status); setGithubReason(query.get("reason") ?? ""); setView("sources");
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const railButton = (target: View, icon: ReactNode, label: string) => (
    <button type="button" className={`rail-btn ${view === target ? "is-active" : ""}`} onClick={() => setView(target)} aria-label={label} title={label} aria-current={view === target ? "page" : undefined}>{icon}<span>{label}</span></button>
  );

  return (
    <div className="cockpit">
      <nav className="rail" aria-label="Workspace">
        <Link href="/welcome" className="rail-logo" aria-label="About Waypoint"><span className="brand-symbol" aria-hidden="true"><i /><i /><i /></span></Link>
        {railButton("cockpit", <LayoutDashboard size={19} />, "Cockpit")}
        {railButton("sources", <Network size={19} />, "Sources")}
        {railButton("investigations", <FolderOpen size={19} />, "Investigations")}
        <div className="rail-spacer" />
        <button type="button" className="rail-btn" onClick={() => { setChatKey((key) => key + 1); setActivity(IDLE); setView("cockpit"); }} aria-label="New question" title="New question"><MessageSquarePlus size={19} /><span>New</span></button>
        <form action={signOut}><button className="rail-btn" type="submit" aria-label="Sign out" title="Sign out"><LogOut size={19} /><span>Sign out</span></button></form>
      </nav>

      <div className="ck-main">
        <header className="ck-top">
          <div className="ck-crumb"><span className="avatar" aria-hidden="true">{workspaceName.slice(0, 1).toUpperCase()}</span><strong>{workspaceName}</strong><span className="ck-role">{role}</span></div>
          <div className="ck-status"><span className={`connection-dot ${graphStatus}`} /> Graph {graphStatus}<span className="ck-sep" />Read-only agent · you approve every action</div>
        </header>

        <div hidden={view !== "cockpit"} className="ck-body">
          <GraphExplorer canManage={canManage} active={view === "cockpit"} activity={activity} onAsk={(text) => setPrefill({ text, n: Date.now() })} onOpenSources={() => setView("sources")} onLoaded={onGraphLoaded} onScopeChange={setScope} />
          <aside className="dock" aria-label="Agent">
            <div className="dock-head">
              <span><i className={`dock-dot ${activity.running ? "is-busy" : ""}`} />Agent</span>
              <button type="button" className="dock-history" onClick={() => setHistoryOpen((open) => !open)} aria-expanded={historyOpen}><History size={14} /> History</button>
              {historyOpen && <div className="history-pop">
                <div className="history-title">Recent investigations <button type="button" onClick={() => setHistoryOpen(false)} aria-label="Close history"><X size={13} /></button></div>
                {recent.length === 0 && <p>Nothing yet — ask your first question.</p>}
                {recent.map((item) => <Link key={item.id} href={`/investigations/${item.id}`}><strong>{item.title}</strong><small>{workflowDomainLabel(item.workflow_domain)}</small></Link>)}
              </div>}
            </div>
            <WorkspaceAskPanel key={chatKey} workspaceName={workspaceName} onInvestigationSaved={loadRecent} prefill={prefill} onActivity={setActivity} starters={starters} scope={scope} />
          </aside>
        </div>

        <div hidden={view !== "sources"} className="sheet workspace-sections">
          {githubNotice === "connected" && <p className="auth-message page-notice" role="status">GitHub App installation connected. Choose a repository below and sync it.</p>}
          {githubNotice === "error" && <p className="auth-error page-notice" role="alert">{GITHUB_REASONS[githubReason] ?? "The GitHub installation could not be linked."} Use the checklist below for the exact settings.</p>}
          {sources}
          <section className="workspace-card next-step"><div className="eyebrow">CONNECTED ENGINEERING CONTEXT</div><h2>Connect an operational source</h2><p>GitHub repositories can be authorized above. Connect a deployed service to investigate incidents with real evidence. This workspace does not contain demo records.</p></section>
        </div>
        <div hidden={view !== "investigations"} className="sheet workspace-sections">
          <section id="investigations" className="workspace-card">
            <div className="eyebrow">INVESTIGATION WORKFLOW</div><h2>Investigations</h2>
            <p>Create a durable investigation, then inspect its facts, prior attempts, events, and action proposals.</p>
            {investigations}
          </section>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";

const nav = ["Overview", "Knowledge", "Memory", "Investigations", "Settings"];
const sources = [
  { icon: "◈", title: "Checkout service · deploy #1842", meta: "Deployment · 18 min ago", color: "violet" },
  { icon: "▤", title: "INC-284 · payment failures", meta: "Incident · Updated 24 min ago", color: "amber" },
  { icon: "⌘", title: "Retry policy decision", meta: "Decision · 3 days ago", color: "blue" },
];
type GraphAnswer = { answer: string; sources: { title: string; kind: string; source: string }[]; path: string[]; hopLimit: number };

export default function Home() {
  const [active, setActive] = useState("Overview");
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState(false);
  const [approved, setApproved] = useState(false);
  const [notice, setNotice] = useState("");
  const [graphAnswer, setGraphAnswer] = useState<GraphAnswer | null>(null);
  const [graphStatus, setGraphStatus] = useState("not checked");
  const [asking, setAsking] = useState(false);

  async function askQuestion() {
    if (!query.trim() || asking) return;
    setAsking(true);
    setGraphAnswer(null);
    try {
      const response = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: query }) });
      const result = await response.json();
      if (response.ok) {
        setGraphAnswer(result);
        setAsked(true);
        setNotice("Answer retrieved from the connected FalkorDB graph.");
      } else if (response.status === 422) {
        setAsked(false);
        setNotice(result.error);
      } else {
        setAsked(true);
        setNotice(`${result.error} Showing a clearly marked seeded demo response.`);
      }
    } catch {
      setAsked(true);
      setNotice("FalkorDB Cloud could not be reached. Showing a clearly marked seeded demo response.");
    } finally {
      setAsking(false);
    }
  }

  async function checkGraph() {
    setGraphStatus("checking…");
    try {
      const response = await fetch("/api/graph/health");
      setGraphStatus(response.ok ? "connected" : "unavailable");
    } catch {
      setGraphStatus("unavailable");
    }
  }

  return (
    <main className="shell">
      <aside className="rail">
        <div className="brand"><span className="brand-mark">w</span><span>waypoint<span className="brand-dot">.</span></span></div>
        <div className="workspace"><div className="workspace-icon">N</div><div><b>Northwind Labs</b><small>Demo workspace</small></div><span className="chevron">⌄</span></div>
        <div className="nav-label">WORKSPACE</div>
        <nav>{nav.map((item, i) => <button key={item} onClick={() => setActive(item)} className={`nav-item ${active === item ? "selected" : ""}`}><span className="nav-icon">{["◫", "⌘", "◷", "◎", "⚙"][i]}</span>{item}{item === "Investigations" && <span className="nav-count">3</span>}</button>)}</nav>
        <div className="rail-bottom"><div className="status-line"><span className="status-dot" /> Seeded demo · local only</div><div className="profile"><div className="avatar">AD</div><div><b>Alex D.</b><small>Workspace admin</small></div><span className="more">···</span></div></div>
      </aside>

      <section className="content">
        <header className="topbar"><div className="breadcrumbs">Northwind Labs <span>/</span> {active}</div><div className="top-actions"><span className="env-pill"><i /> Demo data</span><button className="help-button" onClick={() => setNotice("Waypoint is a local preview. Authentication, connected sources, persistent storage, and action execution are not configured.")}>? <span>Help</span></button><div className="avatar small-avatar">AD</div></div></header>

        <div className="page-wrap">
          <div className="page-heading"><div><div className="eyebrow">THURSDAY, OCTOBER 15, 2026 <span className="live-dot" /></div><h1>{active === "Overview" ? "Good morning, Alex" : active}</h1><p className="subheading">{active === "Overview" ? "Your agents have the context to pick up where they left off." : `Review connected ${active.toLowerCase()} in your demo workspace.`}</p></div><button className="primary-button" onClick={() => setActive("Investigations")}>＋ <span>New investigation</span></button></div>

          {notice && <div className="notice"><span>ⓘ</span>{notice}<button onClick={() => setNotice("")}>×</button></div>}

          {active === "Overview" ? <>
          <section className="ask-panel">
            <div className="ask-kicker"><span className="spark">✳</span> ASK YOUR COMPANY CONTEXT</div>
            <h2>What are you trying to figure out?</h2>
            <p>Ask across decisions, incidents, services, and agent memory.</p>
            <div className="ask-input"><span className="search-icon">⌕</span><input id="ask-box" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void askQuestion(); }} placeholder="Why are checkout payments failing?" /><button onClick={() => void askQuestion()} aria-label="Ask question" disabled={asking}>{asking ? "…" : "↑"}</button></div>
            <div className="suggestions"><span>TRY</span><button onClick={() => setQuery("What changed before the payment incident?")}>What changed before the incident?</button><button onClick={() => setQuery("What have we already tried?")}>What have we already tried?</button></div>
          </section>

          <div className="section-row"><div><div className="section-label">PICK UP WHERE YOU LEFT OFF</div><h2 className="section-title">Active investigations <span className="count-chip">3</span></h2></div><button className="text-link" onClick={() => setActive("Investigations")}>View all <span>→</span></button></div>
          <div className="investigation-grid">
            <article className="investigation-card featured"><div className="card-top"><span className="incident-tag"><i /> INCIDENT · INC-284</span><button className="dots">···</button></div><h3>Payment failures after checkout deploy</h3><p>Retry volume spiked after deploy #1842. The team is tracing the change against the previous rollback.</p><div className="card-meta"><span><b className="avatar mini">MK</b> Maya K.</span><span>Updated 8 min ago</span></div><div className="card-footer"><div className="avatars"><b className="avatar mini">MK</b><b className="avatar mini second">JD</b><b className="avatar mini third">AI</b></div><span className="memory-chip">◷ 4 memories</span><button className="open-arrow" aria-label="Open investigation">↗</button></div></article>
            <article className="investigation-card"><div className="card-top"><span className="progress-tag"><i /> IN PROGRESS</span><button className="dots">···</button></div><h3>Reduce onboarding latency</h3><p>Tracing the slow path between identity verification and workspace setup.</p><div className="card-meta"><span><b className="avatar mini violet-avatar">SR</b> Sam R.</span><span>Updated 1 hr ago</span></div><div className="card-footer"><div className="avatars"><b className="avatar mini violet-avatar">SR</b><b className="avatar mini second">AI</b></div><span className="memory-chip">◷ 2 memories</span><button className="open-arrow" aria-label="Open investigation">↗</button></div></article>
          </div>

          {asked && <section className="answer-panel"><div className="answer-head"><span className="answer-icon">✳</span><div><b>Here’s what the connected context shows</b><small>{graphAnswer ? `FALKORDB GRAPH · ${graphAnswer.sources.length} SOURCES · ${graphAnswer.hopLimit}-HOP LIMIT` : "SEEDED DEMO ANSWER · 3 SOURCES"}</small></div><button onClick={() => setAsked(false)} aria-label="Close answer">×</button></div><p>{graphAnswer ? graphAnswer.answer : <>The seeded graph links checkout deploy #1842 to incident <b>INC-284</b>, and connects the incident to the retry policy decision and a previous rollback attempt.</>}</p>{graphAnswer ? <div className="board-note">Graph evidence path: {graphAnswer.path.filter(Boolean).join(" → ") || "source records returned"}</div> : <div className="answer-caveat">There is no observed rollback outcome in this demo, so it cannot confirm that rollback is safe now.</div>}<div className="source-list">{graphAnswer ? graphAnswer.sources.map((source) => <div key={`${source.source}-${source.title}`} className="source-row"><span className="source-icon violet">◈</span><div><b>{source.title}</b><small>{source.kind} · {source.source}</small></div><span className="source-arrow">↗</span></div>) : sources.map((source) => <div key={source.title} className="source-row"><span className={`source-icon ${source.color}`}>{source.icon}</span><div><b>{source.title}</b><small>{source.meta}</small></div><span className="source-arrow">↗</span></div>)}</div><button className="trace-link" onClick={() => setActive("Knowledge")}>⌘ View evidence path <span>→</span></button></section>}

          <div className="lower-grid">
            <section className="surface memory-surface"><div className="surface-head"><div><div className="section-label">DURABLE CONTEXT</div><h2 className="section-title">Recent memory</h2></div><button className="text-link" onClick={() => setActive("Memory")}>Memory <span>→</span></button></div><div className="memory-item"><span className="memory-symbol violet">◷</span><div><b>Rollback was attempted once</b><p>Retry rate remained high; reverted config in deploy #1837.</p><small>INC-284 <span>·</span> 3 days ago</small></div><span className="confidence">SOURCE LINKED</span></div><div className="memory-item"><span className="memory-symbol blue">◇</span><div><b>Checkout owner is Maya Kim</b><p>Service ownership confirmed by the team directory.</p><small>TEAM DIRECTORY <span>·</span> 6 days ago</small></div><span className="confidence">CURRENT</span></div><div className="memory-bottom"><span>Showing 2 of 12 memories</span><button onClick={() => setActive("Memory")}>Browse memory <span>→</span></button></div></section>

            <section className="surface action-surface"><div className="action-top"><div><div className="section-label">NEEDS YOUR REVIEW</div><h2 className="section-title">Proposed action</h2></div><span className="pending">PENDING</span></div><div className="action-body"><div className="action-symbol">↶</div><div><b>Rollback checkout to deploy #1837</b><p>Proposed by incident-responder · 6 min ago</p></div></div><div className="action-reason"><span>WHY THIS ACTION</span><p>Previous incident notes show elevated failures after retry changes. Review the evidence and target before approving.</p><button onClick={() => setActive("Knowledge")}>Review evidence <span>↗</span></button></div><div className="action-controls"><button className="secondary-button" onClick={() => { setNotice("Proposal rejected in this local demo. No action was executed."); setApproved(false); }}>Reject</button><button className="approve-button" onClick={() => { setApproved(true); setNotice("Demo approval recorded locally. No deployment was executed."); }}>{approved ? "✓ Approved (demo)" : "Approve proposal"}</button></div></section>
          </div>
          </> : <section className="section-board">
            <div className="section-board-head"><div><div className="section-label">NORTHWIND LABS · SEEDED DEMO</div><h2>{active === "Knowledge" ? "Sources and evidence" : active === "Memory" ? "Current context and history" : active === "Investigations" ? "Incident work and handoffs" : "Workspace settings"}</h2><p>{active === "Knowledge" ? "Follow claims back to their source before acting." : active === "Memory" ? "Inspect what carries across agent sessions and what changed." : active === "Investigations" ? "Resume the investigation with its evidence, attempts, and next owner." : "Review workspace access, connected sources, and data controls."}</p></div><span className="env-pill"><i /> Demo data</span></div>
            {active === "Knowledge" && <><div className="evidence-path"><span>checkout service</span><b>→</b><span>deploy #1842</span><b>→</b><span>INC-284</span><b>→</b><span>retry policy decision</span></div><div className="source-list board-source-list">{sources.map((source) => <div key={source.title} className="source-row"><span className={`source-icon ${source.color}`}>{source.icon}</span><div><b>{source.title}</b><small>{source.meta} · source revision verified</small></div><button className="source-open" onClick={() => setNotice(`Opened ${source.title} in the demo evidence panel.`)}>Inspect ↗</button></div>)}</div><div className="board-note">Evidence path capped at 4 hops. This seeded answer uses 3 sources; import and live graph traversal are not connected yet.</div></>}
            {active === "Memory" && <><div className="memory-history"><div className="memory-version current"><span className="version-tag">CURRENT · V2</span><h3>Checkout retry policy changed in deploy #1842</h3><p>Elevated retry volume was observed after the deployment. Source: deploy #1842 and incident INC-284.</p><small>Captured 18 minutes ago · source linked · review required</small></div><div className="memory-version"><span className="version-tag">SUPERSEDED · V1</span><h3>Rollback to deploy #1837 was attempted</h3><p>Retry rate remained high after the prior configuration rollback.</p><small>Captured 3 days ago · INC-284</small></div></div><div className="board-note">The demo keeps current and historical facts distinct. Persistent versioned writes and workspace permissions are the next backend slice.</div></>}
            {active === "Investigations" && <><div className="timeline"><div><span className="timeline-point"/><small>18 MIN AGO</small><b>Deploy #1842 changed checkout retry handling</b><p>Source linked · deploy event</p></div><div><span className="timeline-point amber-point"/><small>14 MIN AGO</small><b>Incident INC-284 opened after payment failures rose</b><p>Owner: Maya Kim · status: investigating</p></div><div><span className="timeline-point violet-point"/><small>6 MIN AGO</small><b>Agent proposed rollback to deploy #1837</b><p>Waiting for human review · no action executed</p></div></div><div className="handoff-row"><div><b>Next handoff</b><p>Responder agent will receive the current incident, evidence path, and previous attempt.</p></div><button className="secondary-button" onClick={() => setNotice("Handoff preview ready. Durable task claiming and recipient acknowledgement are not connected yet.")}>Preview handoff</button></div></>}
            {active === "Settings" && <><div className="settings-grid"><section className="settings-card"><span className="section-label">WORKSPACE</span><h3>Northwind Labs</h3><p>Demo workspace · local seeded data</p><div className="settings-value"><span>Workspace isolation</span><b>Preview only</b></div></section><section className="settings-card"><span className="section-label">FALKORDB CLOUD</span><h3>Graph connection: {graphStatus}</h3><p>Graph queries run on the server; cloud credentials never reach the browser.</p><button className="source-open" onClick={() => void checkGraph()}>Check cloud connection</button></section><section className="settings-card"><span className="section-label">AGENT ACCESS</span><h3>API keys</h3><p>No keys are stored or accepted by this preview.</p><button className="source-open" onClick={() => setNotice("Key management requires the authenticated backend, which is not configured.")}>Key management unavailable</button></section><section className="settings-card"><span className="section-label">DATA CONTROLS</span><h3>Export and deletion</h3><p>Persistent memory and deletion controls are not connected.</p><button className="source-open" onClick={() => setNotice("No user data is stored by this demo, so there is nothing to export or delete.")}>View demo data status</button></section></div><div className="board-note">Workspace authentication, membership enforcement, source imports, persistent memory, API keys, and deletion are not configured.</div></>}
          </section>}

          <footer className="footer"><span>Waypoint <span className="muted">·</span> Your agents, in context.</span><span>Demo workspace <span className="muted">·</span> <button onClick={() => setNotice("This build uses seeded demo data. Authentication and connected sources are not configured yet.")}>About this preview</button></span></footer>
        </div>
      </section>
    </main>
  );
}

"use client";
import Link from "next/link";
import { Fragment, useState, type CSSProperties } from "react";
import { ArrowUpRight, ArrowRight, GitBranch, GitPullRequest, Check, Search, ShieldCheck, Layers, CornerDownRight, Fingerprint, Network, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Brand } from "@/components/brand";
import { FadeContent } from "@/components/fade-content";
import { HeroDemo } from "@/components/hero-demo";
import { GraphCanvas } from "@/components/graph-canvas";
import { SAMPLE_EDGES, SAMPLE_NODES } from "@/lib/sample-graph-data";
import { layoutGraph } from "@/lib/graph-view";

const scenes = [
  { name: "Codebase", question: "What changed before checkout broke?", source: "checkout.ts", signal: "PR #142 · Retry logic", finding: "A missing timeout guard connects the recent change to checkout retries.", action: "Propose a draft pull request", icon: GitBranch },
  { name: "Security", question: "Where does this vulnerable dependency reach?", source: "package.json", signal: "Dependency advisory", finding: "Follow the dependency to affected code, then review the source-version evidence.", action: "Review a remediation plan", icon: ShieldCheck },
  { name: "Memory", question: "What did we already try last time?", source: "Previous investigation", signal: "Attempt · No improvement", finding: "Recall the failed attempt and check what has changed before trying again.", action: "Continue the investigation", icon: Layers },
];

const HEADLINE = ["A", "clearer", "path", "|", "from", "*why", "to", "*done."];
const MARQUEE = [[GitBranch, "Code & changes"], [Network, "Connected evidence"], [Layers, "Team memory"], [ShieldCheck, "Human approval"], [Search, "Cited answers"], [GitPullRequest, "Reviewed actions"]] as const;

const SHOWCASE = layoutGraph({
  nodes: SAMPLE_NODES.map(([label, id, title]) => ({ key: id, label, title })),
  edges: SAMPLE_EDGES.map(([from, type, to]) => ({ from, type, to })),
}, 1000, 560);
const TRACKS = [
  { icon: GitPullRequest, kicker: "ACTS ON CONNECTED DATA", title: "Multi-hop reasoning that ends in an action.", text: "Graph traversal is the agent’s tool. It follows an incident to the pull request, file and owner behind it — then proposes a reviewed fix. Nothing runs without a human approving it.", tags: ["trace_entity", "propose_action", "MCP"] },
  { icon: Layers, kicker: "REMEMBERS & COORDINATES", title: "Memory that survives the session.", text: "Versioned facts with provenance, failed attempts the agent must review before it tries again, and leased tasks with handoffs — isolated per workspace.", tags: ["recall_attempts", "claim_task", "handoff_task"] },
  { icon: Network, kicker: "COMPANY BRAIN", title: "Who owns what, and why it was decided.", text: "People, teams, services, decisions and documents in one graph. Every answer cites its sources and versions, and access follows each person’s role.", tags: ["resolve_entity", "role-scoped ACL", "cited answers"] },
] as const;

export function Landing() {
  const [active, setActive] = useState(0);
  const scene = scenes[active];
  return <div className="landing">
    <div className="aurora" aria-hidden="true"><span className="a1" /><span className="a2" /><span className="a3" /></div>
    <header className="site-header"><Brand /><nav aria-label="Main navigation"><a href="#graph">The graph</a><a href="#approach">The approach</a><a href="#explore">Explore</a><a href="#principles">Built on trust</a></nav><Button asChild variant="outline" size="sm"><Link href="/login">Open workspace <ArrowUpRight size={14} /></Link></Button></header>
    <main>
      <section className="hero shell">
        <div className="hero-copy"><div className="edition fade-up"><span /> CONNECTED INTELLIGENCE, CONSIDERED.</div><h1 aria-label="A clearer path from why to done.">{HEADLINE.map((word, index) => (word === "|"
          ? <br key={index} />
          : <span key={index} className="hw" aria-hidden="true" style={{ "--i": index } as CSSProperties}>{word.startsWith("*") ? <em>{word.slice(1)}</em> : word}{" "}</span>))}</h1><p className="fade-up" style={{ "--d": "700ms" } as CSSProperties}>Your code, evidence, and past decisions.<br className="desktop-break" /> Finally working together.</p><div className="hero-actions fade-up" style={{ "--d": "850ms" } as CSSProperties}><Button asChild size="lg"><Link href="/login">Find your next step <ArrowUpRight size={18} /></Link></Button><a className="text-link" href="#explore">See how it thinks <ArrowRight size={16} /></a></div><div className="hero-note fade-up" style={{ "--d": "1000ms" } as CSSProperties}><ShieldCheck size={15} /> Grounded in evidence. Guided by you.</div></div>
        <HeroDemo />
      </section>
      <div className="marquee" aria-hidden="true"><div className="marquee-track">{[0, 1].map((copy) => <Fragment key={copy}>{MARQUEE.map(([Icon, label]) => <span key={`${copy}${label}`}><Icon /> {label}</span>)}</Fragment>)}</div></div>
      <section className="tracks shell" id="graph"><FadeContent>
        <div className="section-kicker">01 — THE GRAPH IS THE PRODUCT</div>
        <div className="section-intro"><h2>Not a chatbot.<br /><span>A graph the agent can walk.</span></h2><p>Every answer is a path through connected evidence. Waypoint shows that path — the entities and relationships the agent actually followed — so you can trace each decision back to its source.</p></div>
        <div className="showcase"><div className="showcase-bar"><span className="live-dot" /> Knowledge graph · illustrative sample incident · hover a node to follow its links</div><GraphCanvas view={SHOWCASE} navigation={false} label="Illustrative knowledge graph connecting an incident to code, people, decisions and memory" /></div>
        <div className="track-grid">{TRACKS.map((track) => <article key={track.kicker}><track.icon size={22} /><span className="section-kicker">{track.kicker}</span><h3>{track.title}</h3><p>{track.text}</p><div className="track-tags">{track.tags.map((tag) => <code key={tag}>{tag}</code>)}</div></article>)}</div>
      </FadeContent></section>
      <section id="approach" className="approach shell"><FadeContent><div className="section-kicker">01 — THE APPROACH</div><div className="section-intro"><h2>The answer isn’t in one tab.<br /><span>It’s between them.</span></h2><p>Engineering work rarely arrives neatly packaged. Waypoint brings the relevant relationships into view, so you can understand what happened—and decide what comes next.</p></div><div className="steps"><article><span className="step-number">01</span><Network /><h3>Connect the dots.</h3><p>Bring repository context into your workspace. Follow changes, findings, and their relationships.</p></article><article><span className="step-number">02</span><Search /><h3>Follow the evidence.</h3><p>Ask a question. Inspect the sources and reasoning behind an investigation, including what’s uncertain.</p></article><article><span className="step-number">03</span><GitPullRequest /><h3>Make the next move.</h3><p>Review a bounded proposal. You approve the action, and its outcome stays with the investigation.</p></article></div></FadeContent></section>
      <section className="explore-section" id="explore"><div className="shell"><FadeContent><div className="section-kicker">02 — A LOOK INSIDE</div><div className="explore-heading"><h2>Context that goes<br /><em>somewhere.</em></h2><p>From a question to an evidence trail.<br />Explore an illustrative workflow.</p></div><div className="product-preview"><aside><Brand /><div className="preview-space"><span>W</span> Engineering <ChevronDown size={14} /></div><div className="preview-nav active"><Search size={16} /> Investigations</div><div className="preview-nav"><Network size={16} /> Sources</div><div className="preview-nav"><Layers size={16} /> Memory</div><small>ILLUSTRATIVE PREVIEW<br />Not live workspace data</small></aside><div className="preview-main"><div className="preview-top"><span>Workspace <span>/</span> Explore an investigation</span><span className="preview-badge">Example</span></div><div className="demo-tabs" role="tablist" aria-label="Illustrative workflows">{scenes.map((item, index) => <button key={item.name} role="tab" id={`scene-tab-${index}`} aria-controls="scene-panel" aria-selected={active === index} onClick={() => setActive(index)} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + scenes.length) % scenes.length; setActive(next); document.getElementById(`scene-tab-${next}`)?.focus(); } }} tabIndex={active === index ? 0 : -1}><item.icon size={15} />{item.name}</button>)}</div><div id="scene-panel" role="tabpanel" aria-labelledby={`scene-tab-${active}`} className="scene-panel"><div className="demo-question"><span className="user-avatar">You</span><h3>{scene.question}</h3></div><div className="demo-response"><span className="response-label"><span className="small-logo">w</span> WAYPOINT / EVIDENCE TRAIL</span><div className="source-chips"><span><scene.icon size={14} /> {scene.source}</span><ArrowRight size={14} /><span>{scene.signal}</span></div><p>{scene.finding}</p><div className="review-preview"><GitPullRequest size={19} /><div><strong>{scene.action}</strong><small>Requires your review and approval</small></div><ArrowUpRight size={18} /></div></div></div><div className="preview-input">Follow the evidence. Ask a better question.<span><CornerDownRight size={17} /></span></div></div></div></FadeContent></div></section>
      <section id="principles" className="principles shell"><FadeContent><div className="section-kicker">03 — BUILT ON TRUST</div><div className="principles-grid"><h2>Powerful assistance.<br /><span>Human by design.</span></h2><div className="principle-list"><article><span>01</span><div><h3>Every claim has a trail.</h3><p>Inspect the sources behind an answer. When evidence is missing, uncertainty should be visible.</p></div></article><article><span>02</span><div><h3>Your approval is the boundary.</h3><p>Proposals and execution are separate steps. Meaningful actions stay under human control.</p></div></article><article><span>03</span><div><h3>Context with a sense of place.</h3><p>Workspace membership determines access. Connected context is scoped to the people allowed to use it.</p></div></article></div></div></FadeContent></section>
      <section className="closing shell"><div className="closing-mark">↗</div><div className="section-kicker">YOUR NEXT CHAPTER</div><h2>Less context switching.<br />More <em>forward.</em></h2><Button asChild size="lg"><Link href="/login">Start with a workspace <ArrowUpRight size={18} /></Link></Button><p>Connect a source. Ask a question. Follow the thread.</p></section>
    </main><footer className="site-footer shell"><Brand /><p>Clarity before action.</p><a href="/login">Open Waypoint <ArrowUpRight size={14} /></a><span>© {new Date().getFullYear()} Waypoint</span></footer>
  </div>;
}

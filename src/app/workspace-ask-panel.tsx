"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, ChevronDown, ExternalLink, FolderOpen, Network, Wrench } from "lucide-react";
import { WORKFLOW_DOMAINS, workflowDomainLabel, type WorkflowDomain } from "@/lib/workflow-domains";
import { Textarea } from "@/components/ui/textarea";
import { ShinyText } from "@/components/shiny-text";
import type { GraphActivity } from "@/components/graph-explorer";
import { graphPathsForDisplay, type GraphDisplayPath } from "@/lib/graph-path-display";

const TOOL_LABELS: Record<string, string> = {
  search_entities: "search", graph_overview: "overview", resolve_entity: "resolve", trace_entity: "trace", find_experts: "find experts",
  impact_analysis: "impact", shortest_path: "shortest path", recall_facts: "recall facts", recall_attempts: "recall attempts", list_tasks: "tasks", explain_evidence: "explain",
};

// Human-readable name for a cited source: the graph title when the agent traversed it, otherwise decoded from the ID.
function friendlySource(citation: { sourceId: string }, titles: Map<string, { title: string; label: string }>) {
  const known = titles.get(citation.sourceId);
  if (known) return { kind: known.label, name: known.title };
  const [prefix, kind, ...rest] = citation.sourceId.split(":");
  if (prefix === "github") {
    const tail = rest.slice(1).join(":");
    if (kind === "commit") return { kind: "Commit", name: tail.slice(0, 7) || citation.sourceId };
    if (kind === "file") return { kind: "File", name: tail || citation.sourceId };
    if (kind === "repo") return { kind: "Repository", name: `repository ${rest[0] ?? ""}` };
    if (kind === "pull") return { kind: "Pull request", name: tail };
    if (kind === "issue") return { kind: "Issue", name: tail };
    if (kind === "person") return { kind: "Person", name: rest.join(":") };
    return { kind: kind ?? "Source", name: tail || citation.sourceId };
  }
  if (prefix === "sample") return { kind: "Sample", name: citation.sourceId.slice(7) };
  return { kind: "Source", name: citation.sourceId };
}

type AskResult = {
  answer: string;
  abstained: boolean;
  claims?: Array<{ text: string; citations: Array<{ sourceId: string; version: string; url?: string }> }>;
  uncertainty: string;
  usedTools: string[];
  citations: Array<{ sourceId: string; version: string; url?: string }>;
  alternatives: Array<{ label: string; claims: Array<{ text: string; citations: Array<{ sourceId: string; version: string }> }> }>;
  truncated: boolean;
};
type Investigation = { id: string; title: string; workflow_domain: WorkflowDomain };
type Turn = {
  id: string; question: string; domain: WorkflowDomain; status: "running" | "done" | "error";
  progress: string[]; paths: GraphDisplayPath[]; investigation: Investigation | null; result: AskResult | null; error: string;
};

const STARTERS = [
  "Give me an overview of our engineering graph: the most connected parts and who works on them.",
  "Who knows the most about our most-changed files?",
  "What have earlier investigations already tried?",
];

export function WorkspaceAskPanel({ workspaceName, onInvestigationSaved, prefill, onActivity, starters, scope }: { workspaceName: string; onInvestigationSaved?: () => void; prefill?: { text: string; n: number }; onActivity?: (activity: GraphActivity) => void; starters?: string[]; scope?: { value: string; label: string } }) {
  const [question, setQuestion] = useState("");
  const [workflowDomain, setWorkflowDomain] = useState<WorkflowDomain | "">("codebase_work");
  const [turns, setTurns] = useState<Turn[]>([]);
  const progressStream = useRef<EventSource | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const running = turns.some((turn) => turn.status === "running");

  useEffect(() => () => progressStream.current?.close(), []);
  useEffect(() => { if (prefill) { setQuestion(prefill.text); textarea.current?.focus(); } }, [prefill]);
  useEffect(() => {
    const last = turns[turns.length - 1];
    const nodes = new Set<string>(), edges = new Set<string>();
    for (const path of last?.paths ?? []) path.nodes.forEach((node, position) => {
      const key = node.sourceId ?? node.id;
      nodes.add(key);
      const next = path.nodes[position + 1];
      if (next) edges.add(`${key}|${next.sourceId ?? next.id}`);
    });
    onActivity?.({ nodes, edges, running: last?.status === "running" });
  }, [turns, onActivity]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [turns]);
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [question]);

  function patch(id: string, change: (turn: Turn) => Partial<Turn>) {
    setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, ...change(turn) } : turn)));
  }

  async function ask(event?: FormEvent) {
    event?.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || !workflowDomain || running) return;
    const turnId = crypto.randomUUID();
    const progress = (label: string) => patch(turnId, (turn) => ({ progress: [...turn.progress.slice(-9), label] }));
    setTurns((current) => [...current, { id: turnId, question: trimmedQuestion, domain: workflowDomain, status: "running", progress: [], paths: [], investigation: null, result: null, error: "" }]);
    setQuestion("");
    let stream: EventSource | null = null;
    try {
      const createdResponse = await fetch("/api/investigations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmedQuestion.slice(0, 200), workflowDomain }),
      });
      const createdBody = await createdResponse.json();
      if (!createdResponse.ok) throw new Error(createdBody.error ?? "Investigation could not be created.");
      const created = createdBody.investigation as Investigation;
      patch(turnId, () => ({ investigation: created }));
      onInvestigationSaved?.();

      const runId = crypto.randomUUID();
      stream = new EventSource(`/api/investigations/${created.id}/runs/${runId}/events`);
      progressStream.current = stream;
      stream.addEventListener("run_trace", (event) => {
        try {
          const trace = JSON.parse((event as MessageEvent<string>).data) as { event_type?: string; payload?: { tool?: string; graphPaths?: unknown } };
          if (trace.event_type === "tool_call") {
            const found = graphPathsForDisplay(trace.payload?.graphPaths);
            if (found.length) patch(turnId, (turn) => ({ paths: [...turn.paths, ...found].slice(-40) }));
          }
          const label = trace.event_type === "run_started" ? "Run started"
            : trace.event_type === "tool_call" ? `Tool: ${trace.payload?.tool ?? "unknown"}`
              : trace.event_type === "run_completed" ? "Run completed"
                : trace.event_type === "run_failed" ? "Run failed" : "Run updated";
          progress(label);
          if (trace.event_type === "run_completed" || trace.event_type === "run_failed") stream?.close();
        } catch { progress("Run progress event could not be read"); }
      });
      stream.addEventListener("run_stream_error", () => {
        progress("Live progress disconnected; the final trace will reload after the run");
        stream?.close();
      });
      stream.addEventListener("run_deleted", () => {
        progress("Investigation deleted; run progress stopped");
        stream?.close();
      });
      const runResponse = await fetch("/api/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ investigationId: created.id, question: trimmedQuestion, idempotencyKey: crypto.randomUUID(), runId, scope: scope?.value ?? "all", scopeLabel: scope?.label ?? "" }),
      });
      const runBody = await runResponse.json();
      if (!runResponse.ok) throw new Error(runBody.error ?? "The connected-data question could not be answered.");
      patch(turnId, () => ({ status: "done", result: runBody as AskResult }));
    } catch (cause) {
      patch(turnId, () => ({ status: "error", error: cause instanceof Error ? cause.message : "The connected-data question could not be answered." }));
    } finally {
      stream?.close();
      if (progressStream.current === stream) progressStream.current = null;
      onInvestigationSaved?.();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(); }
  }

  const evidenceNote = "The workflow selects investigation guidance; available evidence depends on connected workspace sources. Fraud and deployment integrations are not configured yet. Agents propose actions; you approve them.";
  const canSend = !running && !!question.trim() && !!workflowDomain;
  const composer = (
    <form className="composer" onSubmit={ask}>
      <Textarea ref={textarea} id="workspace-question" aria-label="Question" rows={1} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={onKeyDown} maxLength={4000} disabled={running} placeholder="Ask how connected entities, code changes, or prior attempts relate…" />
      <div className="composer-bar">
        <label className={`domain-pill ${workflowDomain ? "is-set" : ""}`}>
          <span className="sr-only">Workflow</span>
          <select id="workspace-workflow" value={workflowDomain} onChange={(event) => setWorkflowDomain(event.target.value as WorkflowDomain | "")} disabled={running} required>
            <option value="">Choose workflow…</option>
            {WORKFLOW_DOMAINS.filter((domain) => domain !== "general").map((domain) => <option key={domain} value={domain}>{workflowDomainLabel(domain)}</option>)}
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </label>
        <span className="scope-chip" title="The agent only reads this part of the graph. Change it with the selector above the graph."><Network size={11} /> {scope && scope.value !== "all" ? scope.label : "All sources"}</span>
        <span className="composer-hint">Enter to send</span>
        <button className="send-button" type="submit" disabled={!canSend} aria-label="Ask Waypoint"><ArrowUp size={18} /></button>
      </div>
    </form>
  );

  if (turns.length === 0) {
    return (
      <section className="chat-main chat-empty" aria-labelledby="workspace-ask-title">
        <div className="chat-hero">
          <span className="hero-glyph" aria-hidden="true"><i /><i /><i /></span>
          <h1 id="workspace-ask-title">What would you like to understand?</h1>
          <p>Ask across {workspaceName}. Every question becomes a saved investigation with evidence you can inspect.</p>
        </div>
        <div className="chat-dock">
          {composer}
          <div className="starter-row">{(starters?.length ? starters : STARTERS).map((starter) => <button key={starter} type="button" className="starter-chip" onClick={() => { setQuestion(starter); textarea.current?.focus(); }}>{starter}</button>)}</div>
          <p className="dock-note">{evidenceNote}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="chat-main" aria-label="Conversation">
      <div className="chat-scroll" ref={scroller}>
        <div className="chat-thread">
          {turns.map((turn) => <TurnView key={turn.id} turn={turn} />)}
        </div>
      </div>
      <div className="chat-dock">{composer}<p className="dock-note">{evidenceNote}</p></div>
    </section>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  const { result } = turn;
  const titles = useMemo(() => {
    const map = new Map<string, { title: string; label: string }>();
    for (const path of turn.paths) for (const node of path.nodes) map.set(node.sourceId ?? node.id, { title: node.title, label: node.label });
    return map;
  }, [turn.paths]);
  const sourceNumber = (citation: { sourceId: string; version: string }) =>
    (result?.citations.findIndex((item) => item.sourceId === citation.sourceId && item.version === citation.version) ?? -1) + 1;
  const traced = useMemo(() => {
    const keys = new Set<string>(); let hops = 0;
    for (const path of turn.paths) { hops += path.relationships.length; for (const node of path.nodes) keys.add(node.sourceId ?? node.id); }
    return keys.size ? { entities: keys.size, hops } : null;
  }, [turn.paths]);
  return (
    <article className="turn">
      <div className="user-message"><p>{turn.question}</p><small>{workflowDomainLabel(turn.domain)}</small></div>
      <div className="assistant-message">
        <span className="assistant-avatar" aria-hidden="true"><i /><i /><i /></span>
        <div className="assistant-body" aria-live="polite">
          {turn.status === "running" && <div className="thinking">
            <ShinyText text={turn.progress.length ? "Investigating connected evidence…" : "Starting investigation…"} />
            {turn.progress.length > 0 && <ol className="step-list" role="status">{turn.progress.map((step, index) => <li key={`${index}:${step}`}>{step}</li>)}</ol>}
          </div>}
          {traced && <div className="path-summary"><span className="live-dot" />Graph path · {traced.entities} entities, {traced.hops} hops <em>{turn.status === "running" ? "lighting up on the graph…" : "highlighted on the graph"}</em></div>}
          {turn.status === "error" && <p className="auth-error" role="alert">{turn.error}</p>}
          {result && <>
            {result.abstained && <span className="abstain-badge">Not enough evidence to answer</span>}
            {result.claims?.length ? <ul className="claim-list">{result.claims.map((claim, index) => <li key={`${index}:${claim.text}`}>
              {claim.text}{" "}{claim.citations.map((citation) => { const n = sourceNumber(citation); return <a key={n} className="ref" href={`#${turn.id}-src-${n}`} title={friendlySource(citation, titles).name}>{n}</a>; })}
            </li>)}</ul> : <p className="answer-text">{result.answer}</p>}
            {result.citations.length > 0 && <details className="sources" open={result.citations.length <= 4}>
              <summary>Sources · {result.citations.length}</summary>
              <ol>{result.citations.map((citation, index) => {
                const source = friendlySource(citation, titles);
                return <li key={`${citation.sourceId}:${citation.version}`} id={`${turn.id}-src-${index + 1}`}>
                  <span className="source-kind">{source.kind}</span>
                  {citation.url ? <a href={citation.url} target="_blank" rel="noreferrer">{source.name} <ExternalLink size={11} /></a> : <span>{source.name}</span>}
                </li>;
              })}</ol>
            </details>}
            {result.uncertainty && !/^(none|n\/a|no uncertainty)\.?$/i.test(result.uncertainty.trim()) && <p className="uncertainty"><strong>Uncertainty:</strong> {result.uncertainty}</p>}
            {result.alternatives.length > 0 && <details className="turn-details">
              <summary>Evidence-backed alternatives ({result.alternatives.length})</summary>
              {result.alternatives.map((alternative) => <section key={alternative.label}>
                <h4>{alternative.label}</h4>
                {alternative.claims.map((claim, index) => <p key={`${claim.text}:${index}`}>{claim.text} <small>{claim.citations.map((citation) => `${citation.sourceId} · ${citation.version}`).join(", ")}</small></p>)}
              </section>)}
            </details>}
            <div className="turn-meta">
              <span><Wrench size={12} /> {result.usedTools.length ? `Graph walk: ${result.usedTools.map((tool) => TOOL_LABELS[tool] ?? tool).join(" → ")}` : "No tools selected"}</span>
              {turn.investigation && <Link href={`/investigations/${turn.investigation.id}`}><FolderOpen size={12} /> Open investigation</Link>}
            </div>
            {result.truncated && <p className="fine-print" role="status">Some run details were truncated to fit the trace limits.</p>}
          </>}
        </div>
      </div>
    </article>
  );
}

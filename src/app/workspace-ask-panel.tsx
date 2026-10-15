"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { WORKFLOW_DOMAINS, workflowDomainLabel, type WorkflowDomain } from "@/lib/workflow-domains";

type AskResult = {
  answer: string;
  abstained: boolean;
  uncertainty: string;
  usedTools: string[];
  citations: Array<{ sourceId: string; version: string; url?: string }>;
  alternatives: Array<{ label: string; claims: Array<{ text: string; citations: Array<{ sourceId: string; version: string }> }> }>;
  truncated: boolean;
};

export function WorkspaceAskPanel() {
  const [question, setQuestion] = useState("");
  const [workflowDomain, setWorkflowDomain] = useState<WorkflowDomain | "">("");
  const [investigation, setInvestigation] = useState<{ id: string; title: string; workflow_domain: WorkflowDomain } | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<string[]>([]);
  const progressStream = useRef<EventSource | null>(null);

  useEffect(() => () => progressStream.current?.close(), []);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || !workflowDomain || running) return;
    setRunning(true);
    setError("");
    setResult(null);
    setInvestigation(null);
    setRunProgress([]);
    let stream: EventSource | null = null;
    try {
      const createdResponse = await fetch("/api/investigations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmedQuestion.slice(0, 200), workflowDomain }),
      });
      const createdBody = await createdResponse.json();
      if (!createdResponse.ok) throw new Error(createdBody.error ?? "Investigation could not be created.");
      const created = createdBody.investigation as { id: string; title: string; workflow_domain: WorkflowDomain };
      setInvestigation(created);

      const runId = crypto.randomUUID();
      stream = new EventSource(`/api/investigations/${created.id}/runs/${runId}/events`);
      progressStream.current = stream;
      stream.addEventListener("run_trace", (event) => {
        try {
          const trace = JSON.parse((event as MessageEvent<string>).data) as { event_type?: string; payload?: { tool?: string } };
          const label = trace.event_type === "run_started" ? "Run started"
            : trace.event_type === "tool_call" ? `Tool: ${trace.payload?.tool ?? "unknown"}`
              : trace.event_type === "run_completed" ? "Run completed"
                : trace.event_type === "run_failed" ? "Run failed" : "Run updated";
          setRunProgress((current) => [...current.slice(-9), label]);
          if (trace.event_type === "run_completed" || trace.event_type === "run_failed") stream?.close();
        } catch { setRunProgress((current) => [...current.slice(-9), "Run progress event could not be read"]); }
      });
      stream.addEventListener("run_stream_error", () => {
        setRunProgress((current) => [...current.slice(-9), "Live progress disconnected; the final trace will reload after the run"]);
        stream?.close();
      });
      stream.addEventListener("run_deleted", () => {
        setRunProgress((current) => [...current.slice(-9), "Investigation deleted; run progress stopped"]);
        stream?.close();
      });
      const runResponse = await fetch("/api/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ investigationId: created.id, question: trimmedQuestion, idempotencyKey: crypto.randomUUID(), runId }),
      });
      const runBody = await runResponse.json();
      if (!runResponse.ok) throw new Error(runBody.error ?? "The connected-data question could not be answered.");
      setResult(runBody as AskResult);
      setQuestion("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The connected-data question could not be answered.");
    } finally {
      stream?.close();
      if (progressStream.current === stream) progressStream.current = null;
      setRunning(false);
    }
  }

  return (
    <section className="workspace-card" aria-labelledby="workspace-ask-title">
      <div className="eyebrow">READ-ONLY GRAPH INVESTIGATION</div>
      <h2 id="workspace-ask-title">Ask connected data</h2>
      <p>Waypoint will create a durable investigation, inspect authorized graph evidence, and keep the run trace available for review. This workspace question cannot create tasks, facts, or proposals.</p>
      <form className="agent-question-form" onSubmit={ask}>
        <label htmlFor="workspace-workflow">Workflow</label>
        <select id="workspace-workflow" value={workflowDomain} onChange={(event) => { setWorkflowDomain(event.target.value as WorkflowDomain | ""); setError(""); setResult(null); }} required disabled={running}>
          <option value="">Choose workflow…</option>
          {WORKFLOW_DOMAINS.filter((domain) => domain !== "general").map((domain) => <option key={domain} value={domain}>{workflowDomainLabel(domain)}</option>)}
        </select>
        <p className="fine-print">This selects investigation guidance; available evidence depends on connected workspace sources. Fraud and deployment source integrations are not configured yet.</p>
        <label htmlFor="workspace-question">Question</label>
        <textarea id="workspace-question" value={question} onChange={(event) => { setQuestion(event.target.value); setError(""); setResult(null); setInvestigation(null); }} maxLength={4000} required disabled={running} placeholder="Ask how connected entities, code changes, or prior attempts relate…" />
        <button className="quiet-button" type="submit" disabled={running || !question.trim() || !workflowDomain}>{running ? "Investigating…" : "Ask Waypoint"}</button>
      </form>
      {runProgress.length > 0 && <p role="status">Run progress: {runProgress.join(" → ")}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {investigation && <p role="status">Saved as <Link href={`/investigations/${investigation.id}`}>{investigation.title}</Link> · {workflowDomainLabel(investigation.workflow_domain)}. You can inspect or continue the investigation there.</p>}
      {result && <div className="agent-answer" aria-live="polite">
        <h3>{result.abstained ? "Not enough evidence to answer" : "Answer"}</h3>
        <p className="agent-answer-text">{result.answer}</p>
        <p><strong>Uncertainty:</strong> {result.uncertainty}</p>
        <p><strong>Tools used:</strong> {result.usedTools.length ? result.usedTools.join(" → ") : "No tools selected"}</p>
        {result.citations.length > 0 && <p><strong>Cited sources:</strong> {result.citations.map((citation) => <span key={`${citation.sourceId}:${citation.version}`}>{citation.url
          ? <a href={citation.url} target="_blank" rel="noreferrer">{citation.sourceId}</a> : citation.sourceId} · {citation.version} </span>)}</p>}
        {result.alternatives.length > 0 && <div className="agent-alternatives">
          <strong>Evidence-backed alternatives</strong>
          {result.alternatives.map((alternative) => <section key={alternative.label}>
            <h4>{alternative.label}</h4>
            {alternative.claims.map((claim, index) => <p key={`${claim.text}:${index}`}>{claim.text} <small>{claim.citations.map((citation) => `${citation.sourceId} · ${citation.version}`).join(", ")}</small></p>)}
          </section>)}
        </div>}
        {result.truncated && <p role="status">Some run details were truncated to fit the trace limits.</p>}
      </div>}
    </section>
  );
}

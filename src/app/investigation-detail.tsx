"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { graphPathsForDisplay } from "@/lib/graph-path-display";
import { buildRecoverySnapshot, recoverySnapshotMarkdown } from "@/lib/recovery-export";
import { workflowDomainLabel, type WorkflowDomain } from "@/lib/workflow-domains";

type Data = {
  investigation: { id: string; title: string; workflow_domain: WorkflowDomain; status: string };
  events: Array<Record<string, unknown>>;
  facts: Array<Record<string, unknown>>;
  factCandidates: Array<Record<string, unknown>>;
  versions: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  proposals: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
};
type AgentCitation = { sourceId: string; version: string; url?: string };
type AgentResult = { runId: string; answer: string; abstained: boolean; actionAcknowledged: boolean; uncertainty: string; claims: { text: string; citations: AgentCitation[] }[]; alternatives: { label: string; claims: { text: string; citations: AgentCitation[] }[] }[]; citations: AgentCitation[]; usedTools: string[]; evidenceIds: string[]; traceUrl: string; truncated: boolean };
type WorkspaceMember = { user_id: string; role: string };

function GraphPathList({ value }: { value: unknown }) {
  const paths = graphPathsForDisplay(value);
  if (!paths.length) return null;
  return <div className="graph-path-list" aria-label="Authorized graph paths">
    <strong>Graph paths</strong>
    {paths.map((path, pathIndex) => <p key={pathIndex}>
      {path.nodes.map((node, nodeIndex) => <span key={`${node.id}:${nodeIndex}`}>
        {node.url ? <a href={node.url} target="_blank" rel="noreferrer">{node.label}: {node.title}</a> : <span>{node.label}: {node.title}</span>}
        {node.version && <small> · {node.version}</small>}
        {nodeIndex < path.nodes.length - 1 && <span className="graph-path-edge"> —{path.relationships[nodeIndex] ?? "RELATED_TO"}→ </span>}
      </span>)}
    </p>)}
  </div>;
}

async function getJson(path: string) {
  const response = await fetch(path, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Investigation data could not be loaded.");
  return body;
}

export function InvestigationDetail({ id, role }: { id: string; role: string }) {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState("");
  const [executing, setExecuting] = useState("");
  const [forgetRequestId, setForgetRequestId] = useState("");
  const [forgetting, setForgetting] = useState(false);
  const [question, setQuestion] = useState("");
  const [requestedWrites, setRequestedWrites] = useState({ proposals: false, factCandidates: false, taskUpdates: false });
  const [operationKey, setOperationKey] = useState("");
  const [agentResult, setAgentResult] = useState<AgentResult | null>(null);
  const [runningAgent, setRunningAgent] = useState(false);
  const [runProgress, setRunProgress] = useState<string[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskOperationKey, setTaskOperationKey] = useState("");
  const [savingTask, setSavingTask] = useState(false);
  const [updatingTask, setUpdatingTask] = useState("");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [handoffRecipients, setHandoffRecipients] = useState<Record<string, string>>({});
  const [handoffKeys, setHandoffKeys] = useState<Record<string, string>>({});
  const [recoveryStatus, setRecoveryStatus] = useState("");
  const agentController = useRef<AbortController | null>(null);
  const agentProgressStream = useRef<EventSource | null>(null);

  useEffect(() => () => {
    agentController.current?.abort();
    agentProgressStream.current?.close();
  }, []);

  async function refresh() {
    setError("");
    const root = `/api/investigations/${id}`;
    const [investigation, events, facts, candidates, attempts, tasks, proposals, runs, memberResult] = await Promise.all([
      getJson(root), getJson(`${root}/events`), getJson(`${root}/facts`),
      role === "owner" || role === "admin" ? getJson(`${root}/facts/candidates`) : Promise.resolve({ candidates: [] }),
      getJson(`${root}/attempts`), getJson(`${root}/tasks`), getJson(`${root}/action-proposals`), getJson(`${root}/runs`), getJson("/api/workspace-members"),
    ]);
    setData({ investigation: investigation.investigation, events: events.events, facts: facts.facts, factCandidates: candidates.candidates, versions: facts.versions, attempts: attempts.attempts, tasks: tasks.tasks, proposals: proposals.proposals, runs: runs.runs });
    setMembers(memberResult.members);
  }

  useEffect(() => {
    refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Investigation data could not be loaded."));
  }, [id]);

  useEffect(() => {
    if (!forgetRequestId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await getJson(`/api/forget-requests/${forgetRequestId}`);
        if (result.request.status === "complete") {
          router.replace("/");
          return;
        }
      } catch {
        if (!stopped) setError("Deletion is still running; its status could not be refreshed.");
      }
      if (!stopped) timer = setTimeout(poll, 2000);
    }
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [forgetRequestId, router]);

  async function forgetInvestigation() {
    if (!window.confirm("Permanently delete this investigation and its derived graph records? It will disappear after graph cleanup is verified.")) return;
    agentController.current?.abort();
    agentProgressStream.current?.close();
    agentProgressStream.current = null;
    setForgetting(true);
    setError("");
    try {
      const response = await fetch(`/api/investigations/${id}/forget`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Deletion could not be started.");
      setForgetRequestId(body.request.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Deletion could not be started.");
    } finally {
      setForgetting(false);
    }
  }

  async function review(proposal: Record<string, unknown>, decision: "approve" | "reject") {
    const proposalId = String(proposal.id);
    setReviewing(proposalId);
    setError("");
    try {
      const response = await fetch(`/api/investigations/${id}/action-proposals/${proposalId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, expectedContentHash: proposal.content_hash }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Proposal review failed.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Proposal review failed.");
    } finally {
      setReviewing("");
    }
  }

  async function reviewFact(candidate: Record<string, unknown>, decision: "approve" | "reject") {
    const candidateId = String(candidate.id);
    setReviewing(candidateId);
    setError("");
    try {
      const response = await fetch(`/api/investigations/${id}/facts/candidates/${candidateId}/review`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Fact review failed.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Fact review failed.");
    } finally {
      setReviewing("");
    }
  }

  async function execute(proposal: Record<string, unknown>) {
    if (!window.confirm(`Create a draft pull request for ${String((proposal.target as Record<string, unknown>)?.repository ?? "the reviewed repository")}? This creates a branch and PR but does not merge it.`)) return;
    const proposalId = String(proposal.id);
    setExecuting(proposalId);
    setError("");
    try {
      const response = await fetch(`/api/investigations/${id}/action-proposals/${proposalId}/execute`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedContentHash: proposal.content_hash }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Proposal execution failed.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Proposal execution failed.");
      await refresh().catch(() => undefined);
    } finally {
      setExecuting("");
    }
  }

  async function askAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRunningAgent(true);
    setAgentResult(null);
    setError("");
    const key = operationKey || crypto.randomUUID();
    setOperationKey(key);
    const runId = crypto.randomUUID();
    setRunProgress([]);
    const stream = new EventSource(`/api/investigations/${id}/runs/${runId}/events`);
    agentProgressStream.current = stream;
    stream.addEventListener("run_trace", (event) => {
      try {
        const trace = JSON.parse((event as MessageEvent<string>).data) as { event_type?: string; payload?: { tool?: string } };
        const label = trace.event_type === "run_started" ? "Run started"
          : trace.event_type === "tool_call" ? `Tool: ${trace.payload?.tool ?? "unknown"}`
            : trace.event_type === "run_completed" ? "Run completed"
              : trace.event_type === "run_failed" ? "Run failed" : "Run updated";
        setRunProgress((current) => [...current.slice(-9), label]);
        if (trace.event_type === "run_completed" || trace.event_type === "run_failed") stream.close();
      } catch { setRunProgress((current) => [...current.slice(-9), "Run progress event could not be read"]); }
    });
    stream.addEventListener("run_stream_error", () => {
      setRunProgress((current) => [...current.slice(-9), "Live progress disconnected; the final trace will reload after the run"]);
      stream.close();
    });
    stream.addEventListener("run_deleted", () => {
      setRunProgress((current) => [...current.slice(-9), "Investigation deleted; run progress stopped"]);
      stream.close();
    });
    const controller = new AbortController();
    agentController.current = controller;
    try {
      const response = await fetch(`/api/investigations/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ question, idempotencyKey: key, requestedWrites, runId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Investigation run failed.");
      setAgentResult(body as AgentResult);
      setQuestion("");
      setRequestedWrites({ proposals: false, factCandidates: false, taskUpdates: false });
      setOperationKey("");
      await refresh();
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Investigation run failed.");
    } finally {
      if (agentController.current === controller) agentController.current = null;
      if (agentProgressStream.current === stream) agentProgressStream.current = null;
      stream.close();
      setRunningAgent(false);
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingTask(true);
    setError("");
    const idempotencyKey = taskOperationKey || crypto.randomUUID();
    setTaskOperationKey(idempotencyKey);
    try {
      const response = await fetch(`/api/investigations/${id}/tasks`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: taskTitle, idempotencyKey }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Task could not be created.");
      setTaskTitle("");
      setTaskOperationKey("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Task could not be created.");
    } finally { setSavingTask(false); }
  }

  async function updateTask(task: Record<string, unknown>, action: "claim" | "complete" | "acknowledge_handoff" | "handoff", recipientUserId?: string) {
    const taskId = String(task.id);
    setUpdatingTask(taskId);
    setError("");
    const handoffKey = `${taskId}:${recipientUserId ?? ""}`;
    const idempotencyKey = action === "handoff" ? handoffKeys[handoffKey] ?? crypto.randomUUID() : undefined;
    if (idempotencyKey) setHandoffKeys((current) => ({ ...current, [handoffKey]: idempotencyKey }));
    try {
      const response = await fetch(`/api/investigations/${id}/tasks/${encodeURIComponent(taskId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...(recipientUserId ? { recipientUserId } : {}), ...(idempotencyKey ? { idempotencyKey } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Task could not be updated.");
      if (action === "handoff") setHandoffKeys((current) => { const next = { ...current }; delete next[handoffKey]; return next; });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Task could not be updated.");
    } finally { setUpdatingTask(""); }
  }

  function exportRecovery(format: "json" | "md") {
    if (!data) return;
    const snapshot = buildRecoverySnapshot(data);
    const content = format === "json" ? JSON.stringify(snapshot, null, 2) : recoverySnapshotMarkdown(snapshot);
    const url = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json" : "text/markdown" }));
    const link = document.createElement("a");
    const safeTitle = data.investigation.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "investigation";
    link.href = url;
    link.download = `waypoint-${safeTitle}-recovery.${format === "json" ? "json" : "md"}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    const selected = snapshot.activeTasks.length + snapshot.currentFacts.length + snapshot.recentAttempts.length;
    const omitted = snapshot.omitted.tasks + snapshot.omitted.facts + snapshot.omitted.attempts;
    setRecoveryStatus(`Recovery export downloaded with ${selected} selected records${omitted ? `; ${omitted} records omitted to fit its 12 KB limit` : ""}.`);
  }

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <div className="brand"><span className="brand-mark">w</span><span>waypoint<span className="brand-dot">.</span></span></div>
        <Link className="quiet-button back-link" href="/">All investigations</Link>
      </header>
      <section className="workspace-card detail-heading">
        <div className="eyebrow">{data ? workflowDomainLabel(data.investigation.workflow_domain).toUpperCase() : "INVESTIGATION"}</div>
        <h1>{data?.investigation.title ?? "Investigation"}</h1>
        <p>Stored evidence, current facts, prior attempts, and proposed actions for this workspace investigation.</p>
        {(role === "owner" || role === "admin") && <button className="reject-button" disabled={forgetting || Boolean(forgetRequestId)} onClick={forgetInvestigation}>{forgetting ? "Starting deletion…" : "Delete investigation and derived data"}</button>}
      </section>
      {error && <p className="workspace-error" role="alert">{error}</p>}
      {forgetRequestId && <section className="workspace-card" role="status"><p>Deletion is pending. This investigation will leave the workspace after graph cleanup is verified.</p></section>}
      {!data ? <section className="workspace-card"><p>Loading investigation data…</p></section> : <>
        <section className="workspace-card">
          <div className="eyebrow">SESSION RECOVERY</div>
          <h2>Export recovery context</h2>
          <p>Download current facts, open tasks, and recent attempts to carry this investigation into another session. Run and tool traces are excluded. The export is capped at 12 KB.</p>
          <div className="review-actions">
            <button className="quiet-button" type="button" onClick={() => exportRecovery("md")}>Download Markdown</button>
            <button className="quiet-button" type="button" onClick={() => exportRecovery("json")}>Download JSON</button>
          </div>
          {recoveryStatus && <p role="status">{recoveryStatus}</p>}
        </section>
        <section className="workspace-card">
          <div className="eyebrow">CONNECTED-DATA AGENT</div>
          <h2>Investigate with graph evidence</h2>
          <form className="agent-question-form" onSubmit={askAgent}>
            <label htmlFor="agent-question">Question or task</label>
            <textarea id="agent-question" value={question} onChange={(event) => { setQuestion(event.target.value); setRequestedWrites({ proposals: false, factCandidates: false, taskUpdates: false }); setOperationKey(crypto.randomUUID()); }} maxLength={4000} required placeholder="Ask about connected entities, previous attempts, or a proposed next step…" />
            <fieldset className="agent-write-permissions" disabled={runningAgent || forgetting || Boolean(forgetRequestId)}>
              <legend>Allow writes for this run</legend>
              <label><input type="checkbox" checked={requestedWrites.proposals} onChange={(event) => setRequestedWrites((current) => ({ ...current, proposals: event.target.checked }))} /> Draft a proposal for human review</label>
              <label><input type="checkbox" checked={requestedWrites.factCandidates} onChange={(event) => setRequestedWrites((current) => ({ ...current, factCandidates: event.target.checked }))} /> Submit a fact candidate for owner/admin review</label>
              <label><input type="checkbox" checked={requestedWrites.taskUpdates} onChange={(event) => setRequestedWrites((current) => ({ ...current, taskUpdates: event.target.checked }))} /> Create or update investigation tasks</label>
            </fieldset>
            <button className="quiet-button" type="submit" disabled={runningAgent || forgetting || Boolean(forgetRequestId) || !question.trim()}>{runningAgent ? "Investigating…" : "Run investigation"}</button>
          </form>
          <p className="fine-print">The agent can inspect authorized graph evidence and create reviewable proposals. It cannot execute provider actions.</p>
          {runProgress.length > 0 && <p role="status">Run progress: {runProgress.join(" → ")}</p>}
          {agentResult && <div className="agent-answer" aria-live="polite">
            <h3>{agentResult.abstained ? "Abstained" : agentResult.actionAcknowledged ? "Action recorded" : "Finding"}</h3>
            <p className="agent-answer-text">{agentResult.answer}</p>
            <p><strong>Uncertainty:</strong> {agentResult.uncertainty}</p>
            <p><strong>Tools used:</strong> {agentResult.usedTools.length ? agentResult.usedTools.join(" → ") : "No tools selected"}</p>
            <p><strong>Evidence IDs:</strong> {agentResult.evidenceIds.length ? agentResult.evidenceIds.join(", ") : "No evidence IDs returned"}</p>
            {agentResult.citations.length > 0 && <p><strong>Cited sources:</strong> {agentResult.citations.map((citation) => <span key={`${citation.sourceId}:${citation.version}`}>{citation.url ? <a href={citation.url} target="_blank" rel="noreferrer">{citation.sourceId}</a> : citation.sourceId} · {citation.version} </span>)}</p>}
            {agentResult.alternatives.length > 0 && <div className="agent-alternatives">
              <strong>Evidence-backed alternatives</strong>
              {agentResult.alternatives.map((alternative) => <section key={alternative.label}>
                <h4>{alternative.label}</h4>
                {alternative.claims.map((claim, index) => <p key={`${claim.text}:${index}`}>{claim.text} <small>{claim.citations.map((citation) => `${citation.sourceId} · ${citation.version}`).join(", ")}</small></p>)}
              </section>)}
            </div>}
            {agentResult.truncated && <p role="status">Some run details were truncated to fit the trace limits.</p>}
            <div className="review-actions">
              <Link className="quiet-button" href={`#run-${agentResult.runId}`}>Inspect run {agentResult.runId}</Link>
              <Link className="quiet-button" href={agentResult.traceUrl} target="_blank" rel="noreferrer">Open trace JSON</Link>
            </div>
          </div>}
        </section>
        <section className="workspace-card">
          <div className="eyebrow">PERSISTENT WORK</div>
          <h2>Tasks and handoffs</h2>
          <form className="inline-form" onSubmit={createTask}>
            <label htmlFor="task-title">Add a task</label>
            <div className="inline-form-row">
              <input id="task-title" value={taskTitle} onChange={(event) => { setTaskTitle(event.target.value); setTaskOperationKey(crypto.randomUUID()); }} maxLength={200} required />
              <button className="quiet-button" type="submit" disabled={savingTask || !taskTitle.trim()}>{savingTask ? "Saving…" : "Create task"}</button>
            </div>
          </form>
          {data.tasks.length === 0 ? <p>No tasks recorded. Open tasks will be available when this investigation is resumed.</p> : <ul className="record-list">
            {data.tasks.map((task) => {
              const handoff = task.pending_handoff as Record<string, unknown> | null;
              const closed = task.status === "completed" || task.status === "cancelled";
              return <li key={String(task.id)}>
                <div className="proposal-title"><strong>{String(task.title)}</strong><span className="status-pill">{String(task.status)}</span></div>
                <small>Task {String(task.id)} · v{String(task.version)} · owner {String(task.owner_id ?? "unclaimed")}{task.lease_expires_at ? ` · lease until ${String(task.lease_expires_at)}` : ""}</small>
                {handoff && <p>Pending handoff from {String(handoff.from_user_id)} · requested {String(handoff.requested_at)}</p>}
                {task.status === "claimed" && members.length > 0 && <div className="inline-form-row">
                  <label htmlFor={`handoff-recipient-${String(task.id)}`}>Handoff to</label>
                  <select id={`handoff-recipient-${String(task.id)}`} value={handoffRecipients[String(task.id)] ?? ""} onChange={(event) => setHandoffRecipients((current) => ({ ...current, [String(task.id)]: event.target.value }))}>
                    <option value="">Select a workspace member</option>
                    {members.map((member) => <option key={member.user_id} value={member.user_id}>{member.user_id} · {member.role}</option>)}
                  </select>
                  <button className="quiet-button" type="button" disabled={updatingTask === task.id || !handoffRecipients[String(task.id)]} onClick={() => updateTask(task, "handoff", handoffRecipients[String(task.id)])}>Request handoff</button>
                </div>}
                <div className="review-actions">
                  {!closed && <button className="quiet-button" type="button" disabled={updatingTask === task.id} onClick={() => updateTask(task, "claim")}>Claim or renew task</button>}
                  {task.status === "claimed" && <button className="quiet-button" type="button" disabled={updatingTask === task.id} onClick={() => updateTask(task, "complete")}>Complete task</button>}
                  {handoff && <button className="quiet-button" type="button" disabled={updatingTask === task.id} onClick={() => updateTask(task, "acknowledge_handoff")}>Accept handoff</button>}
                </div>
              </li>;
            })}
          </ul>}
          <p className="fine-print">Task state, ownership, lease expiry, and handoff acceptance are checked by the workspace database on every change.</p>
        </section>
        <section className="workspace-card">
          <div className="eyebrow">QUARANTINED MEMORY</div>
          <h2>Fact candidates awaiting review</h2>
          {data.factCandidates.length === 0 ? <p>No fact candidates need review.</p> : <ul className="record-list">
            {data.factCandidates.map((candidate) => <li key={String(candidate.id)}>
              <strong>{String(candidate.fact_key)} · proposed by {String(candidate.submitted_by)}</strong>
              <pre>{JSON.stringify(candidate.value, null, 2)}</pre>
              <small>Expected fact version: {String(candidate.expected_version)} · Evidence: {JSON.stringify(candidate.provenance)}</small>
              <div className="review-actions">
                <button className="quiet-button" type="button" disabled={reviewing === candidate.id} onClick={() => reviewFact(candidate, "approve")}>Approve into current facts</button>
                <button className="quiet-button" type="button" disabled={reviewing === candidate.id} onClick={() => reviewFact(candidate, "reject")}>Reject candidate</button>
              </div>
            </li>)}
          </ul>}
          <p className="fine-print">Agent-submitted memory stays out of trusted recall and the graph until an owner or admin approves it.</p>
        </section>
        <section className="workspace-card">
          <div className="eyebrow">CURRENT FACTS</div>
          <h2>Facts and revisions</h2>
          {data.facts.length === 0 ? <p>No current facts have been recorded.</p> : <ul className="record-list">
            {data.facts.map((fact) => <li key={String(fact.id)}>
              <strong>{String(fact.fact_key)} · v{String(fact.version)}</strong>
              <pre>{JSON.stringify(fact.value, null, 2)}</pre>
              <small>Provenance: {JSON.stringify(fact.provenance)}</small>
            </li>)}
          </ul>}
          {data.versions.length > 0 && <details><summary>Revision history ({data.versions.length})</summary><ul className="record-list">
            {data.versions.map((version) => <li key={String(version.id)}><strong>{String(version.fact_key)} · v{String(version.version)}</strong><pre>{JSON.stringify(version.value, null, 2)}</pre></li>)}
          </ul></details>}
        </section>
        <section className="workspace-card">
          <div className="eyebrow">PRIOR ATTEMPTS</div>
          <h2>What was tried</h2>
          {data.attempts.length === 0 ? <p>No attempts recorded.</p> : <ul className="record-list">
            {data.attempts.map((attempt) => <li key={String(attempt.id)}>
              <strong>{String(attempt.attempt_key)} · #{String(attempt.attempt_number)} · {String(attempt.outcome)}</strong>
              <p>{String(attempt.summary)}</p>
              <small>Conditions: {JSON.stringify(attempt.condition_snapshot)}</small>
              {typeof attempt.retry_explanation === "string" && <p>Why conditions changed: {attempt.retry_explanation}</p>}
              {Array.isArray(attempt.changed_conditions) && attempt.changed_conditions.length > 0 && <small>Changed-condition evidence: {JSON.stringify(attempt.changed_conditions)}</small>}
            </li>)}
          </ul>}
        </section>
        <section className="workspace-card">
          <div className="eyebrow">ACTION REVIEW</div>
          <h2>Proposals</h2>
          {data.proposals.length === 0 ? <p>No action proposals.</p> : <ul className="record-list">
            {data.proposals.map((proposal) => <li key={String(proposal.id)}>
              <div className="proposal-title"><strong>{String(proposal.proposal_type)}</strong><span className="status-pill">{String(proposal.status)}</span></div>
              <p>{String(proposal.rationale)}</p>
              <p><strong>Risk:</strong> {String(proposal.risk)}</p>
              <details><summary>Target, exact inputs, and evidence</summary><pre>{JSON.stringify({ target: proposal.target, inputs: proposal.inputs, evidence: proposal.evidence, content_hash: proposal.content_hash }, null, 2)}</pre></details>
              {proposal.status === "proposed" && (role === "owner" || role === "admin") && <div className="review-actions">
                <button className="quiet-button" disabled={reviewing === proposal.id} onClick={() => review(proposal, "approve")}>Approve exact proposal</button>
                <button className="reject-button" disabled={reviewing === proposal.id} onClick={() => review(proposal, "reject")}>Reject</button>
              </div>}
              {(proposal.status === "approved" || proposal.status === "failed") && proposal.proposal_type === "github_patch" && (role === "owner" || role === "admin") && <div className="review-actions">
                <button className="quiet-button" disabled={executing === proposal.id} onClick={() => execute(proposal)}>{executing === proposal.id ? "Creating draft PR…" : proposal.status === "failed" ? "Retry draft PR creation" : "Create draft pull request"}</button>
              </div>}
              {proposal.status === "succeeded" && typeof (proposal.execution_result as Record<string, unknown> | null)?.url === "string" && <p>
                <a href={String((proposal.execution_result as Record<string, unknown>).url)} target="_blank" rel="noreferrer">Open verified pull request #{String((proposal.execution_result as Record<string, unknown>).number)}</a>
                {` · ${((proposal.execution_result as Record<string, unknown>).draft === true) ? "draft" : "ready for review"} · checks: ${String((proposal.execution_result as Record<string, unknown>).checks ?? "unavailable")}`}
              </p>}
              {proposal.status === "failed" && <p role="status">Execution was not verified; retry reconciles any branch or pull request already created.</p>}
            </li>)}
          </ul>}
          <p className="fine-print">Only an owner/admin can execute a still-approved GitHub patch. Execution creates and verifies a draft pull request; it never merges. GitHub checks may remain pending.</p>
        </section>
        <section className="workspace-card">
          <div id="agent-runs" />
          <div className="eyebrow">AGENT RUNS</div>
          <h2>Tool calls and evidence</h2>
          {data.runs.length === 0 ? <p>No agent runs recorded.</p> : <ul className="record-list">
            {data.runs.map((run) => {
              const events = Array.isArray(run.events) ? run.events as Array<Record<string, unknown>> : [];
              const startPayload = events.find((event) => event.event_type === "run_started")?.payload as Record<string, unknown> | undefined;
              const availableTools = Array.isArray(startPayload?.availableTools)
                ? startPayload.availableTools.filter((tool): tool is string => typeof tool === "string").join(", ") || "none"
                : "not recorded";
              return <li key={String(run.id)} id={`run-${String(run.id)}`}>
              <div className="proposal-title"><strong>{String(run.status)} · {String(run.model ?? "Unknown model")}</strong><span>{String(run.startedAt ?? "")}</span></div>
              <small>Run {String(run.id)} · model revision {String(run.modelRevision ?? "unknown")} · prompt revision {String(run.promptRevision ?? "unknown")}{run.truncated === true ? " · output truncated" : ""}</small>
              <small>Tools available to this run: {availableTools}</small>
              {events.map((event, index) => {
                const traceEvent = event as Record<string, unknown>;
                const payload = traceEvent.payload as Record<string, unknown> | null;
                return <details key={`${String(traceEvent.id)}-${index}`}>
                  <summary>{String(traceEvent.event_type)}{typeof payload?.tool === "string" ? ` · ${payload.tool}` : ""}</summary>
                  {payload?.tool === "trace_entity" && <GraphPathList value={payload.graphPaths} />}
                  <pre>{JSON.stringify(traceEvent.payload, null, 2)}</pre>
                </details>;
              })}
            </li>;
            })}
          </ul>}
        </section>
        <section className="workspace-card">
          <div className="eyebrow">INVESTIGATION HISTORY</div>
          <h2>Evidence and decisions</h2>
          {data.events.length === 0 ? <p>No events recorded.</p> : <ul className="record-list">
            {[...data.events].reverse().map((event) => <li key={String(event.id)}>
              <strong>{String(event.event_type)}</strong><small>{String(event.created_at)}</small>
              <pre>{JSON.stringify(event.payload, null, 2)}</pre>
            </li>)}
          </ul>}
        </section>
      </>}
    </main>
  );
}

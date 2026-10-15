"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { WORKFLOW_DOMAINS, workflowDomainLabel, type WorkflowDomain } from "@/lib/workflow-domains";

type Investigation = { id: string; title: string; workflow_domain: WorkflowDomain; status: string; updated_at: string };

export function InvestigationsPanel() {
  const [items, setItems] = useState<Investigation[]>([]);
  const [title, setTitle] = useState("");
  const [workflowDomain, setWorkflowDomain] = useState<WorkflowDomain | "">("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setError("");
    const response = await fetch("/api/investigations", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Investigations could not be loaded.");
    setItems(body.investigations);
  }

  useEffect(() => {
    refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Investigations could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/investigations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, workflowDomain }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Investigation could not be created.");
      setTitle("");
      setWorkflowDomain("");
      setItems((current) => [body.investigation, ...current].slice(0, 50));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Investigation could not be created.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="investigations-panel">
      <form className="inline-form" onSubmit={create}>
        <label htmlFor="investigation-title">New investigation</label>
        <div className="inline-form-row">
          <input id="investigation-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required />
          <select aria-label="Investigation workflow" value={workflowDomain} onChange={(event) => setWorkflowDomain(event.target.value as WorkflowDomain | "")} required>
            <option value="">Choose workflow…</option>
            {WORKFLOW_DOMAINS.filter((domain) => domain !== "general").map((domain) => <option key={domain} value={domain}>{workflowDomainLabel(domain)}</option>)}
          </select>
          <button className="quiet-button" type="submit" disabled={saving || !workflowDomain}>{saving ? "Creating…" : "Create"}</button>
        </div>
        <p className="fine-print">The workflow selects agent guidance; available evidence depends on connected workspace sources. Fraud and deployment source integrations are not configured yet.</p>
      </form>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {loading ? <p>Loading investigations…</p> : items.length === 0 ? <p>No investigations yet.</p> : (
        <ul className="investigation-list">
          {items.map((item) => (
            <li key={item.id}>
              <Link className="investigation-row" href={`/investigations/${item.id}`}>
                <span><strong>{item.title}</strong><small>{workflowDomainLabel(item.workflow_domain)} · Updated {new Date(item.updated_at).toLocaleString()}</small></span>
                <span className="status-pill">{item.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

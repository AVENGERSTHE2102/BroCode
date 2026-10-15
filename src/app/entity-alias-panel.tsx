"use client";

import { useEffect, useState, type FormEvent } from "react";

type Alias = { id: string; alias: string; target_source_id: string; created_at: string };

export function EntityAliasPanel({ canManage }: { canManage: boolean }) {
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [alias, setAlias] = useState("");
  const [targetIdentifier, setTargetIdentifier] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/entity-aliases", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Aliases could not be loaded.");
    setAliases(body.aliases);
  }

  useEffect(() => {
    refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Aliases could not be loaded."));
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/entity-aliases", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias, targetIdentifier }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Alias could not be created.");
      setAlias("");
      setTargetIdentifier("");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Alias could not be created."); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/entity-aliases/${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Alias could not be removed.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Alias could not be removed."); }
    finally { setBusy(false); }
  }

  return <section className="workspace-card source-panel">
    <div className="eyebrow">ENTITY IDENTITY</div>
    <h2>Reviewed aliases</h2>
    <p>Resolve exact source IDs first. Reviewed aliases are case-insensitive and point to one verified entity; conflicting names are rejected instead of guessed.</p>
    {aliases.length ? <ul className="investigation-list">{aliases.map((item) => <li key={item.id} className="alias-row">
      <span><strong>{item.alias}</strong><small>→ {item.target_source_id}</small></span>
      {canManage && <button className="quiet-button" type="button" onClick={() => remove(item.id)} disabled={busy}>Remove</button>}
    </li>)}</ul> : <p>No reviewed aliases.</p>}
    {canManage && <form className="inline-form" onSubmit={create}>
      <label htmlFor="entity-alias">Alias</label>
      <input id="entity-alias" value={alias} onChange={(event) => setAlias(event.target.value)} maxLength={128} required />
      <label htmlFor="entity-alias-target">Exact entity ID or source ID</label>
      <input id="entity-alias-target" value={targetIdentifier} onChange={(event) => setTargetIdentifier(event.target.value)} maxLength={256} required />
      <button className="quiet-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Add reviewed alias"}</button>
    </form>}
    {!canManage && <p>Ask a workspace owner or admin to add or remove aliases.</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
  </section>;
}

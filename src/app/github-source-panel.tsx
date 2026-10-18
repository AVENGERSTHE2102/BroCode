"use client";

import { useEffect, useState, type FormEvent } from "react";

type Repository = { id: number; fullName: string; private: boolean };
type SyncState = { started_at: string; completed_at: string | null; status: "running" | "succeeded" | "partial" | "failed"; partial_errors: string[]; error_code: string | null };
type Source = { id: string; repository_id: number; full_name: string; html_url: string; default_branch: string; provider_updated_at: string | null; last_sync: SyncState | null };
type SetupCheck = {
  present: Record<string, boolean>; reachable: boolean; callbackUrl: string; boundInstallations: number;
  app: { slug: string; matchesSlug: boolean; missingPermissions: string[]; installations: number } | null;
};
type Installation = { installation_id: number; github_login: string; created_at: string };

function Check({ ok, label }: { ok: boolean; label: string }) {
  return <li className={ok ? "check-ok" : "check-bad"}><span aria-hidden="true">{ok ? "✓" : "✗"}</span>{label}</li>;
}

export function GitHubSourcePanel({ canManage }: { canManage: boolean }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [installationId, setInstallationId] = useState("");
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [repositoriesTruncated, setRepositoriesTruncated] = useState(false);
  const [repositoryId, setRepositoryId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncingSource, setSyncingSource] = useState("");
  const [syncResult, setSyncResult] = useState("");
  const [loading, setLoading] = useState(true);
  const [setup, setSetup] = useState<SetupCheck | null>(null);
  const operatorReady = Boolean(setup && Object.values(setup.present).every(Boolean) && setup.reachable && setup.app?.matchesSlug && setup.app.missingPermissions.length === 0);

  async function refresh() {
    const [sourceResponse, installResponse] = await Promise.all([
      fetch("/api/sources/github", { cache: "no-store" }),
      fetch("/api/sources/github/installations", { cache: "no-store" }),
    ]);
    const [sourceBody, installBody] = await Promise.all([sourceResponse.json(), installResponse.json()]);
    if (!sourceResponse.ok) throw new Error(sourceBody.error ?? "GitHub sources could not be loaded.");
    if (!installResponse.ok) throw new Error(installBody.error ?? "GitHub installations could not be loaded.");
    setSources(sourceBody.sources);
    setInstallations(installBody.installations);
    setInstallationId((current) => current || String(installBody.installations[0]?.installation_id ?? ""));
  }

  async function startInstallation(mode: "install" | "link" = "install") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/sources/github/install-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "GitHub App installation could not be started.");
      window.location.assign(body.installUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "GitHub App installation could not be started.");
      setBusy(false);
    }
  }

  useEffect(() => {
    if (canManage) fetch("/api/sources/github/setup", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).then((body: SetupCheck | null) => setSetup(body)).catch(() => undefined);
    refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "GitHub sources could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  async function loadRepositories(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/sources/github/repositories?installationId=${encodeURIComponent(installationId)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Repositories could not be loaded.");
      setRepositories(body.repositories);
      setRepositoriesTruncated(body.truncated === true);
      setRepositoryId("");
      if (!body.repositories.length) setError("No repositories are available to this GitHub App installation.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Repositories could not be loaded.");
    } finally { setBusy(false); }
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const repository = repositories.find((item) => String(item.id) === repositoryId);
    if (!repository) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/sources/github", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ installationId: Number(installationId), repositoryId: repository.id, fullName: repository.fullName }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Repository could not be connected.");
      await refresh();
      setRepositories([]);
      setRepositoriesTruncated(false);
      setRepositoryId("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Repository could not be connected.");
    } finally { setBusy(false); }
  }

  async function sync(source: Source) {
    setSyncingSource(source.id);
    setError("");
    setSyncResult("");
    try {
      const response = await fetch(`/api/sources/github/${encodeURIComponent(source.id)}/sync`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Repository metadata could not be imported.");
      const { commit = 0, issue = 0, pull_request: pullRequest = 0, file = 0, check_run: checkRun = 0, security_finding: securityFinding = 0 } = body.counts ?? {};
      const partial = Array.isArray(body.partialErrors) && body.partialErrors.length
        ? ` Partial import: ${body.partialErrors.join(" ")}` : "";
      const statusWarning = typeof body.statusWarning === "string" ? ` ${body.statusWarning}` : "";
      setSyncResult(`Saved ${commit} commits, ${issue} issues, ${pullRequest} pull requests, ${file} file records, ${checkRun} CI check runs, and ${securityFinding} security findings (${body.changedRecords ?? 0} records changed). Graph projection is queued.${partial}${statusWarning}`);
      void refresh().catch(() => {});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Repository metadata could not be imported.");
      void refresh().catch(() => {});
    } finally { setSyncingSource(""); }
  }

  return <section className="workspace-card source-panel">
    <div className="eyebrow">CODEBASE AND SECURITY SOURCE</div>
    <h2>GitHub repositories</h2>
    <p>Connect a repository through a GitHub App installation. Sync imports bounded engineering metadata and, when the App has Dependabot alerts read access, security findings. Security findings are restricted to workspace owners and admins.</p>
    {loading ? <p>Loading connected repositories…</p> : sources.length ? <ul className="investigation-list">
      {sources.map((source) => <li key={source.id}><div className="investigation-row">
        <a href={source.html_url} target="_blank" rel="noreferrer">
          <strong>{source.full_name}</strong><small>Default branch: {source.default_branch || "unknown"}</small>
          {canManage && <small>{source.last_sync
            ? `Latest sync ${source.last_sync.status} · ${new Date(source.last_sync.completed_at ?? source.last_sync.started_at).toLocaleString()}${source.last_sync.error_code ? ` · ${source.last_sync.error_code}` : ""}`
            : "Never synced"}</small>}
        </a>
        <span className="status-pill">Connected</span>
        {canManage && <button className="quiet-button" type="button" onClick={() => sync(source)} disabled={busy || Boolean(syncingSource)}>
          {syncingSource === source.id ? "Syncing…" : "Sync metadata"}
        </button>}
        {canManage && source.last_sync?.partial_errors.length ? <small className="source-sync-warning" role="status">{source.last_sync.partial_errors.join(" ")}</small> : null}
      </div></li>)}
    </ul> : <p>No GitHub repositories connected.</p>}
    {canManage && <>
      <div className="review-actions">
        {/* First connect must install the App fresh ("link" only finds installations that already exist); once one
            exists, the primary action switches to "link" to re-sync the list, with "install" offered separately. */}
        <button className="quiet-button" type="button" onClick={() => startInstallation(installations.length ? "link" : "install")} disabled={busy}>{busy ? "Opening GitHub…" : installations.length ? "Reconnect GitHub" : "Connect GitHub"}</button>
        {installations.length > 0 && <button className="quiet-button" type="button" onClick={() => startInstallation("install")} disabled={busy}>Add more repositories</button>}
        {/* Covers the gap where the App is already installed on the user's GitHub account but not yet bound here
            (e.g. a database switch): GitHub treats re-running "install" as an edit and sends no OAuth code, so the
            primary button alone can't recover it — plain OAuth ("link") always returns a code regardless of state. */}
        {installations.length === 0 && <button className="quiet-button" type="button" onClick={() => startInstallation("link")} disabled={busy}>Already installed on GitHub? Link it</button>}
      </div>
      <p className="fine-print">You’ll sign in with GitHub and choose what Waypoint can read. Access is read-only and limited to the repositories you pick.</p>
      {setup && !operatorReady && <details className="setup-check" open>
        <summary>GitHub isn’t fully set up on this server</summary>
        <p className="fine-print">This is a one-time step for whoever runs this Waypoint deployment — your teammates only click “Connect GitHub”.</p>
        <ul>
          <Check ok={Object.values(setup.present).every(Boolean)} label="Server has the GitHub App credentials" />
          <Check ok={setup.reachable} label="Server can authenticate to GitHub as the App" />
          <Check ok={Boolean(setup.app?.matchesSlug)} label="App slug matches the server configuration" />
          <Check ok={Boolean(setup.app) && setup.app!.missingPermissions.length === 0} label={setup.app?.missingPermissions.length ? `App is missing permissions: ${setup.app.missingPermissions.join(", ")}` : "App permissions are sufficient (read-only)"} />
        </ul>
      </details>}
      {setup && <details className="setup-check">
        <summary>Connection failing on GitHub?</summary>
        <p className="fine-print">GitHub shows “redirect_uri is not associated with this application” when this address isn’t registered. In the GitHub App settings add this <strong>Callback URL</strong> (the App can have several): <code>{setup.callbackUrl}</code></p>
      </details>}
      {installations.length > 0 && <form className="inline-form" onSubmit={loadRepositories}>
        <label htmlFor="github-installation-id">Authorized GitHub installation</label>
        <div className="inline-form-row">
          <select id="github-installation-id" value={installationId} onChange={(event) => setInstallationId(event.target.value)} required>
            {installations.map((item) => <option key={item.installation_id} value={item.installation_id}>{item.github_login} · installation {item.installation_id}</option>)}
          </select>
          <button className="quiet-button" type="submit" disabled={busy}>{busy ? "Checking…" : "Load repositories"}</button>
        </div>
      </form>}
      {repositories.length > 0 && <form className="inline-form" onSubmit={connect}>
        <label htmlFor="github-repository">Repository</label>
        <div className="inline-form-row">
          <select id="github-repository" value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)} required>
            <option value="">Select a repository</option>
            {repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.fullName}{repository.private ? " · private" : ""}</option>)}
          </select>
          <button className="quiet-button" type="submit" disabled={busy || !repositoryId}>{busy ? "Verifying…" : "Connect"}</button>
        </div>
      </form>}
      {repositoriesTruncated && <p role="status">Showing the first 500 installation repositories. Narrow the GitHub App installation to the repositories you need.</p>}
    </>}
    {!canManage && <p>Ask a workspace owner or admin to connect a repository.</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    {syncResult && <p role="status">{syncResult}</p>}
  </section>;
}

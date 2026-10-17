"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, ExternalLink, Loader2, Network, RefreshCw, Search, Trash2, X, Zap } from "lucide-react";
import { GraphCanvas } from "@/components/graph-canvas";
import { Button } from "@/components/ui/button";
import { SAMPLE_EDGES, SAMPLE_NODES } from "@/lib/sample-graph-data";
import { labelColor, layoutGraph, type GraphView, type ViewNode } from "@/lib/graph-view";

export type Raw = { nodes: Array<{ key: string; label: string; title: string; version?: string; url?: string; sample?: boolean }>; edges: Array<{ from: string; to: string; type: string }>; truncated?: boolean };
export type GraphActivity = { nodes: Set<string>; edges: Set<string>; running: boolean };

const GHOST = layoutGraph({ nodes: SAMPLE_NODES.map(([label, key, title]) => ({ key, label, title })), edges: SAMPLE_EDGES.map(([from, type, to]) => ({ from, type, to })) }, 1000, 640);

// The cockpit stage: the live workspace graph, with the agent's traversal lit up in real time.
export function GraphExplorer({ canManage, active, activity, onAsk, onOpenSources, onLoaded, onScopeChange }: {
  canManage: boolean; active: boolean; activity: GraphActivity; onAsk?: (question: string) => void; onOpenSources?: () => void; onLoaded?: (raw: Raw) => void; onScopeChange?: (scope: { value: string; label: string }) => void;
}) {
  const [raw, setRaw] = useState<Raw | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("all");
  const [scopeChosen, setScopeChosen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/graph/explore", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The graph could not be loaded.");
      setRaw(body as Raw);
      onLoaded?.(body as Raw);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The graph could not be loaded."); }
    finally { setLoading(false); }
  }, [onLoaded]);
  useEffect(() => { if (active && !raw && !loading && !error) void load(); }, [active, raw, loading, error, load]);

  async function sample(method: "POST" | "DELETE") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/graph/sample", { method });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The sample could not be changed.");
      setSelected(null);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The sample could not be changed."); }
    finally { setBusy(false); }
  }

  async function refreshGraph() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/graph/project", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The graph could not be refreshed.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The graph could not be refreshed."); }
    finally { setBusy(false); }
  }

  // Scopes: everything, one repository (its neighbourhood without crossing into other repositories), or the sample.
  const scopes = useMemo(() => {
    const list: Array<{ value: string; label: string }> = [{ value: "all", label: "All sources" }];
    for (const node of raw?.nodes ?? []) if (node.label === "Repository" && !node.sample) list.push({ value: node.key, label: node.title });
    if (raw?.nodes.some((node) => node.sample)) list.push({ value: "sample", label: "Sample incident" });
    return list;
  }, [raw]);
  // Open on one focused scope (the sample if loaded, otherwise the first repository) until the user picks one.
  useEffect(() => {
    if (!scopes.some((item) => item.value === scope)) { setScope("all"); return; }
    if (!scopeChosen && scopes.length > 2) setScope(scopes.some((item) => item.value === "sample") ? "sample" : scopes[1].value);
  }, [scopes, scope, scopeChosen]);
  useEffect(() => {
    const current = scopes.find((item) => item.value === scope);
    onScopeChange?.({ value: scope, label: current?.label ?? "All sources" });
  }, [scope, scopes, onScopeChange]);
  const scoped: Raw | null = useMemo(() => {
    if (!raw || scope === "all") return raw;
    if (scope === "sample") {
      const keep = new Set(raw.nodes.filter((node) => node.sample).map((node) => node.key));
      return { ...raw, nodes: raw.nodes.filter((node) => keep.has(node.key)), edges: raw.edges.filter((edge) => keep.has(edge.from) && keep.has(edge.to)) };
    }
    const repositories = new Set(raw.nodes.filter((node) => node.label === "Repository").map((node) => node.key));
    const neighbours = new Map<string, string[]>();
    for (const edge of raw.edges) { neighbours.set(edge.from, [...(neighbours.get(edge.from) ?? []), edge.to]); neighbours.set(edge.to, [...(neighbours.get(edge.to) ?? []), edge.from]); }
    const keep = new Set([scope]);
    let frontier = [scope];
    for (let depth = 0; depth < 3 && frontier.length; depth++) {
      const next: string[] = [];
      for (const key of frontier) for (const other of neighbours.get(key) ?? []) {
        if (keep.has(other) || repositories.has(other)) continue;
        keep.add(other); next.push(other);
      }
      frontier = next;
    }
    return { ...raw, nodes: raw.nodes.filter((node) => keep.has(node.key)), edges: raw.edges.filter((edge) => keep.has(edge.from) && keep.has(edge.to)) };
  }, [raw, scope]);
  const view: GraphView | null = useMemo(() => (scoped && scoped.nodes.length ? layoutGraph(scoped, 1000, 640) : null), [scoped]);
  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term && view ? new Set(view.nodes.filter((node) => `${node.title} ${node.label} ${node.key}`.toLowerCase().includes(term)).map((node) => node.key)) : null;
  }, [search, view]);
  const traversal = useMemo(() => (view && activity.nodes.size ? new Set([...activity.nodes].filter((key) => view.nodes.some((node) => node.key === key))) : null), [view, activity.nodes]);
  const highlight = traversal && traversal.size ? traversal : matches;
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of scoped?.nodes ?? []) map.set(node.label, (map.get(node.label) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [scoped]);
  const maxCount = Math.max(1, ...counts.map(([, count]) => count));
  const node = view?.nodes.find((item) => item.key === selected) ?? null;
  const links = useMemo(() => {
    type Link = { dir: "in" | "out"; type: string; other: ViewNode };
    const result: Link[] = [];
    if (!view || !selected) return result;
    const byKey = new Map(view.nodes.map((item) => [item.key, item]));
    for (const edge of view.edges) {
      const otherKey = edge.from === selected ? edge.to : edge.to === selected ? edge.from : null;
      const other = otherKey ? byKey.get(otherKey) : undefined;
      if (other) result.push({ dir: edge.from === selected ? "out" : "in", type: edge.type, other });
    }
    return result;
  }, [view, selected]);
  const hasSample = raw?.nodes.some((item) => item.sample) ?? false;

  return (
    <div className="stage">
      <div className="stage-canvas">
        {view
          ? <GraphCanvas fill view={view} selected={selected} onSelect={setSelected} highlight={highlight} activeEdges={activity.edges} label="Workspace knowledge graph" />
          : <div className="ghost"><GraphCanvas fill compact view={GHOST} label="Preview of a connected knowledge graph" /></div>}
      </div>

      <div className="hud hud-tl">
        <div className="hud-title"><Network size={15} /> Knowledge graph <span className={`hud-live ${raw ? "is-on" : ""}`} /></div>
        {raw && view ? <>
          <div className="hud-stats"><div><b>{view.nodes.length}</b><span>entities</span></div><div><b>{view.edges.length}</b><span>relationships</span></div><div><b>{counts.length}</b><span>types</span></div></div>
          <div className="hud-bars">{counts.slice(0, 6).map(([label, count]) => <div key={label}><span>{label}</span><i style={{ width: `${(count / maxCount) * 100}%`, background: labelColor(label) }} /><b>{count}</b></div>)}</div>
          {hasSample && <p className="hud-note">Dashed outlines = synthetic sample data</p>}
        </> : <p className="hud-note">{loading ? "Reading the graph…" : "Waiting for data"}</p>}
      </div>

      <div className="hud hud-tr">
        {scopes.length > 2 && <label className="stage-scope"><span className="sr-only">Graph scope</span>
          <select value={scope} onChange={(event) => { setScope(event.target.value); setScopeChosen(true); setSelected(null); }}>{scopes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}
        <label className="stage-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find an entity…" aria-label="Find an entity" /></label>
        {canManage && <Button variant="outline" size="sm" className="hud-btn" onClick={refreshGraph} disabled={busy} title="Project newly synced records into the graph">{busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Refresh</Button>}
        {canManage && view && !hasSample && <Button variant="outline" size="sm" className="hud-btn" onClick={() => sample("POST")} disabled={busy}>{busy ? <Loader2 size={13} className="spin" /> : <Database size={13} />} Sample</Button>}
        {canManage && hasSample && <Button variant="outline" size="sm" className="hud-btn" onClick={() => sample("DELETE")} disabled={busy}><Trash2 size={13} /> Clear sample</Button>}
      </div>

      {activity.running && <div className="agent-pill" role="status"><Zap size={13} /> Agent traversing the graph{traversal && traversal.size ? ` · ${traversal.size} entities` : "…"}</div>}
      {!activity.running && traversal && traversal.size > 0 && <div className="agent-pill is-done" role="status"><Zap size={13} /> Answer path highlighted · {traversal.size} entities</div>}

      {error && <p className="stage-error" role="alert">{error}</p>}
      {raw && !view && !loading && <div className="stage-empty">
        <Network size={26} /><h3>Your graph is waiting for data</h3>
        <p>Connect and sync a GitHub repository to project real commits, pull requests and findings into the graph (already synced? press Refresh graph){canManage ? ", or load a labelled sample incident to explore the product right now" : ""}.</p>
        <div className="stage-cta">
          {canManage && <Button size="sm" onClick={refreshGraph} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Refresh graph</Button>}
          {canManage && <Button variant="outline" size="sm" onClick={() => sample("POST")} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <Database size={14} />} Load sample incident</Button>}
          <Button variant="outline" size="sm" onClick={onOpenSources}>Connect GitHub</Button>
        </div>
      </div>}
      {!raw && loading && <div className="stage-empty"><Loader2 size={22} className="spin" /><p>Reading the graph…</p></div>}

      {node && <aside className="inspector glass" aria-live="polite">
        <button type="button" className="inspector-close" onClick={() => setSelected(null)} aria-label="Close inspector"><X size={14} /></button>
        <span className="inspector-label" style={{ background: labelColor(node.label) }}>{node.label}</span>
        <h3>{node.title}</h3>
        <dl><dt>Source</dt><dd>{node.key}</dd>{node.version && <><dt>Version</dt><dd>{node.version}</dd></>}</dl>
        {node.url && <a className="citation-chip" href={node.url} target="_blank" rel="noreferrer">Open source <ExternalLink size={11} /></a>}
        <strong className="inspector-sub">Connections · {links.length}</strong>
        <ul>{links.map((link, index) => <li key={`${link.type}${index}`}><button type="button" onClick={() => setSelected(link.other.key)}><em>{link.dir === "out" ? "→" : "←"} {link.type.replaceAll("_", " ").toLowerCase()}</em>{link.other.title}</button></li>)}</ul>
        {onAsk && <Button size="sm" onClick={() => onAsk(`What is connected to ${node.title}, and why does it matter?`)}>Ask the agent about this</Button>}
      </aside>}
    </div>
  );
}

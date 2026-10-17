"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { labelColor, type GraphView } from "@/lib/graph-view";

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
type Point = { x: number; y: number };
type Body = Point & { vx: number; vy: number };
type Drag = { kind: "pan"; startX: number; startY: number; tx: number; ty: number; moved: boolean }
  | { kind: "node"; key: string; offsetX: number; offsetY: number; moved: boolean };
type Sim = { bodies: Map<string, Body>; home: Map<string, Point>; rest: Map<string, number>; pinned: string | null; target: Point | null; running: boolean; energy: number };

// Label-aware collision: nodes repel inside an ellipse wider than tall (labels sit under nodes), moved positionally
// so nothing overlaps and the graph stays readable.
const COLLIDE_X = 165, COLLIDE_Y = 50;
function separate(bodies: Map<string, Body>, pinned: string | null, strength = .5) {
  const list = [...bodies.entries()];
  let overlap = 0;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const [ka, a] = list[i], [kb, b] = list[j];
    const nx = (a.x - b.x) / COLLIDE_X, ny = (a.y - b.y) / COLLIDE_Y, d = Math.hypot(nx, ny);
    if (d >= 1) continue;
    const ux = d > .001 ? nx / d : 1, uy = d > .001 ? ny / d : 0, push = (1 - d) * strength;
    const sx = ux * push * COLLIDE_X / 2, sy = uy * push * COLLIDE_Y / 2;
    const wa = ka === pinned ? 0 : kb === pinned ? 2 : 1, wb = kb === pinned ? 0 : ka === pinned ? 2 : 1;
    a.x += sx * wa; a.y += sy * wa; b.x -= sx * wb; b.y -= sy * wb;
    overlap += 1 - d;
  }
  return overlap;
}

// Zoom/translate that fits every body inside the viewBox with a margin.
function fitTo(points: Iterable<Point>, width: number, height: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  if (!Number.isFinite(minX)) return { k: 1, x: 0, y: 0 };
  const k = Math.min(1, (width - 120) / Math.max(maxX - minX, 1), (height - 90) / Math.max(maxY - minY, 1));
  return { k, x: width / 2 - ((minX + maxX) / 2) * k, y: height / 2 - ((minY + maxY) / 2) * k + 6 };
}

// Interactive SVG graph with live spring physics: drag a node and its neighbours stretch after it, then everything
// settles elastically. Also: wheel/pinch zoom toward the cursor, background pan, zoom/fit controls, hover focus.
export function GraphCanvas({ view, selected, onSelect, highlight, activeEdges, compact = false, fill = false, navigation = true, label }: {
  view: GraphView; selected?: string | null; onSelect?: (key: string | null) => void; highlight?: Set<string> | null; activeEdges?: Set<string> | null; compact?: boolean; fill?: boolean; navigation?: boolean; label: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [zoom, setZoom] = useState({ k: 1, x: 0, y: 0 });
  const [positions, setPositions] = useState<Map<string, Point>>(new Map());
  const drag = useRef<Drag | null>(null);
  const sim = useRef<Sim>({ bodies: new Map(), home: new Map(), rest: new Map(), pinned: null, target: null, running: false, energy: 0 });
  const interactive = !compact && navigation;
  const reducedMotion = useRef(false);
  useEffect(() => { reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches; }, []);

  // (Re)build the physics bodies whenever the data changes; springs remember the laid-out edge lengths.
  useEffect(() => {
    const bodies = new Map<string, Body>(), home = new Map<string, Point>(), rest = new Map<string, number>();
    for (const node of view.nodes) bodies.set(node.key, { x: node.x, y: node.y, vx: 0, vy: 0 });
    for (let pass = 0; pass < 120 && separate(bodies, null, .6) > .01; pass++);
    for (const [key, body] of bodies) home.set(key, { x: body.x, y: body.y });
    for (const edge of view.edges) {
      const a = home.get(edge.from), b = home.get(edge.to);
      if (a && b) rest.set(`${edge.from}|${edge.to}`, Math.max(40, Math.hypot(a.x - b.x, a.y - b.y)));
    }
    sim.current = { bodies, home, rest, pinned: null, target: null, running: false, energy: 0 };
    setPositions(new Map([...bodies].map(([key, body]) => [key, { x: body.x, y: body.y }])));
    setZoom(fitTo(bodies.values(), view.width, view.height));
  }, [view]);

  const step = useCallback(() => {
    const s = sim.current;
    const list = [...s.bodies.entries()];
    for (const edge of view.edges) {
      const a = s.bodies.get(edge.from), b = s.bodies.get(edge.to), rest = s.rest.get(`${edge.from}|${edge.to}`);
      if (!a || !b || !rest) continue;
      const dx = b.x - a.x, dy = b.y - a.y, dist = Math.max(Math.hypot(dx, dy), 1);
      const force = (dist - rest) * .03, fx = dx / dist * force, fy = dy / dist * force;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
    let energy = 0;
    for (const [key, body] of list) {
      if (key === s.pinned && s.target) { body.vx = (s.target.x - body.x) * .5; body.vy = (s.target.y - body.y) * .5; body.x = s.target.x; body.y = s.target.y; continue; }
      const home = s.home.get(key)!;
      body.vx += (home.x - body.x) * .006; body.vy += (home.y - body.y) * .006;
      body.vx *= .62; body.vy *= .62;
      body.x += body.vx; body.y += body.vy;
      energy += Math.abs(body.vx) + Math.abs(body.vy);
    }
    separate(s.bodies, s.pinned, .5);
    s.energy = energy;
    setPositions(new Map(list.map(([key, body]) => [key, { x: body.x, y: body.y }])));
  }, [view.edges]);

  const kick = useCallback(() => {
    const s = sim.current;
    if (s.running || reducedMotion.current) return;
    s.running = true;
    let frames = 0;
    const loop = () => {
      step();
      frames++;
      if (s.pinned || (s.energy > .15 * Math.max(1, s.bodies.size / 20) && frames < 900)) requestAnimationFrame(loop);
      else s.running = false;
    };
    requestAnimationFrame(loop);
  }, [step]);

  const nodes = useMemo(() => view.nodes.map((node) => ({ ...node, ...(positions.get(node.key) ?? {}) })), [view.nodes, positions]);
  const byKey = useMemo(() => new Map(nodes.map((node) => [node.key, node])), [nodes]);
  const focus = hover ?? selected ?? null;
  const neighbours = useMemo(() => {
    const set = new Set<string>();
    if (focus) { set.add(focus); for (const edge of view.edges) { if (edge.from === focus) set.add(edge.to); if (edge.to === focus) set.add(edge.from); } }
    return set;
  }, [focus, view.edges]);
  const dim = (key: string) => (highlight && highlight.size ? !highlight.has(key) : focus ? !neighbours.has(key) : false);
  const radius = compact ? 9 : 11;

  // Screen point → SVG viewBox coordinates (before the zoom transform).
  const toSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current, matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  };
  const zoomAt = (factor: number, center: Point) => setZoom((current) => {
    const k = Math.min(4, Math.max(.3, current.k * factor));
    const ratio = k / current.k;
    return { k, x: center.x - (center.x - current.x) * ratio, y: center.y - (center.y - current.y) * ratio };
  });

  // Native, non-passive wheel listener so zooming the graph doesn't also scroll the page.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !interactive) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      zoomAt(Math.exp(-event.deltaY * (event.ctrlKey ? .01 : .0015)), { x: point.x, y: point.y });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [interactive]);

  function down(event: ReactPointerEvent<SVGSVGElement>) {
    if (!interactive || event.button !== 0) return;
    const nodeElement = (event.target as Element).closest<SVGGElement>(".gnode");
    const point = toSvg(event.clientX, event.clientY);
    if (nodeElement?.dataset.key) {
      const node = byKey.get(nodeElement.dataset.key);
      if (!node) return;
      drag.current = { kind: "node", key: node.key, offsetX: (point.x - zoom.x) / zoom.k - node.x, offsetY: (point.y - zoom.y) / zoom.k - node.y, moved: false };
    } else {
      drag.current = { kind: "pan", startX: point.x, startY: point.y, tx: zoom.x, ty: zoom.y, moved: false };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: ReactPointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current) return;
    const point = toSvg(event.clientX, event.clientY);
    if (current.kind === "pan") {
      if (Math.abs(point.x - current.startX) + Math.abs(point.y - current.startY) > 3) current.moved = true;
      setZoom((z) => ({ ...z, x: current.tx + point.x - current.startX, y: current.ty + point.y - current.startY }));
      return;
    }
    current.moved = true;
    const target = { x: (point.x - zoom.x) / zoom.k - current.offsetX, y: (point.y - zoom.y) / zoom.k - current.offsetY };
    const s = sim.current;
    if (reducedMotion.current) {
      s.home.set(current.key, target);
      setPositions((map) => new Map(map).set(current.key, target));
      return;
    }
    s.pinned = current.key; s.target = target;
    kick();
  }
  function up(event: ReactPointerEvent<SVGSVGElement>) {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    if (current.kind === "node") {
      const s = sim.current;
      // Wherever things are now becomes home: the dropped node stays put and neighbours just settle, no bounce back.
      if (current.moved) for (const [key, body] of s.bodies) s.home.set(key, key === current.key && s.target ? s.target : { x: body.x, y: body.y });
      s.pinned = null; s.target = null;
      if (current.moved) for (const body of s.bodies.values()) { body.vx *= .3; body.vy *= .3; }
      if (!current.moved) onSelect?.(current.key); else kick();
    }
    if (current.kind === "pan" && !current.moved && event.target === event.currentTarget) onSelect?.(null);
  }
  function reset() {
    const s = sim.current;
    const original = new Map<string, Body>(view.nodes.map((node) => [node.key, { x: node.x, y: node.y, vx: 0, vy: 0 }]));
    for (let pass = 0; pass < 120 && separate(original, null, .6) > .01; pass++);
    for (const [key, body] of original) s.home.set(key, { x: body.x, y: body.y });
    setZoom(fitTo(original.values(), view.width, view.height));
    if (reducedMotion.current) setPositions(new Map([...s.home])); else kick(); // springs carry everything back to the tidy layout
  }

  const center = { x: view.width / 2, y: view.height / 2 };
  const svg = (
    <svg ref={svgRef} preserveAspectRatio="xMidYMid meet" className={`gcanvas ${compact ? "is-compact" : ""} ${fill ? "is-fill" : ""}`} viewBox={`0 0 ${view.width} ${view.height}`} role="img" aria-label={label}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; sim.current.pinned = null; }}>
      <defs><marker id="garrow" viewBox="0 0 10 10" refX="19" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#9aa68e" /></marker></defs>
      <g transform={`translate(${zoom.x} ${zoom.y}) scale(${zoom.k})`}>
        {view.edges.map((edge, index) => {
          const a = byKey.get(edge.from), b = byKey.get(edge.to);
          if (!a || !b) return null;
          const traversed = activeEdges?.has(`${edge.from}|${edge.to}`) || activeEdges?.has(`${edge.to}|${edge.from}`);
          const active = focus === edge.from || focus === edge.to || !!traversed;
          const faded = !traversed && (dim(edge.from) || dim(edge.to));
          return <g key={`${edge.from}|${edge.type}|${edge.to}`} className={`gedge ${active ? "is-active" : ""} ${traversed ? "is-traversed" : ""} ${faded ? "is-dim" : ""}`}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} pathLength={1} markerEnd="url(#garrow)" style={{ animationDelay: `${Math.min(index, 40) * 45}ms` }} />
            {(active || (!compact && zoom.k > 1.3)) && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle">{edge.type.replaceAll("_", " ").toLowerCase()}</text>}
          </g>;
        })}
        {nodes.map((node, index) => {
          const isSelected = selected === node.key;
          return <g key={node.key} data-key={node.key} className={`gnode ${dim(node.key) ? "is-dim" : ""} ${isSelected ? "is-selected" : ""}`} transform={`translate(${node.x} ${node.y})`} tabIndex={0}
            role="button" aria-label={`${node.label}: ${node.title}`} onPointerEnter={() => setHover(node.key)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(node.key)} onBlur={() => setHover(null)}
            onClick={interactive ? undefined : () => onSelect?.(node.key)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect?.(node.key); } }}>
            <g className="gnode-pop" style={{ animationDelay: `${Math.min(index, 40) * 40}ms` }}>
              {(isSelected || highlight?.has(node.key)) && <circle r={radius + 7} className="gnode-halo" fill={labelColor(node.label)} />}
              <circle r={radius} fill={labelColor(node.label)} stroke={node.sample ? "#fff" : "#ffffffd0"} strokeWidth={node.sample ? 2 : 1.5} strokeDasharray={node.sample ? "3 2" : undefined} />
              {(zoom.k > .55 || isSelected || focus === node.key) && <text y={radius + 14} textAnchor="middle" className="gnode-label">{clip(node.title, compact ? 22 : 28)}</text>}
            </g>
          </g>;
        })}
      </g>
    </svg>
  );
  if (!interactive) return svg;
  return (
    <div className={`gwrap ${fill ? "is-fill" : ""}`}>
      {svg}
      <div className="gcontrols" role="group" aria-label="Graph view controls">
        <button type="button" onClick={() => zoomAt(1.25, center)} aria-label="Zoom in" title="Zoom in"><Plus size={15} /></button>
        <button type="button" onClick={() => zoomAt(.8, center)} aria-label="Zoom out" title="Zoom out"><Minus size={15} /></button>
        <button type="button" onClick={reset} aria-label="Fit and reset layout" title="Fit and reset layout"><Maximize2 size={14} /></button>
      </div>
      <span className="ghint">Drag a node to stretch the graph · scroll to zoom · drag the background to pan</span>
    </div>
  );
}

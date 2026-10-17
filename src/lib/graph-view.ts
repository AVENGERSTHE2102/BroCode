import type { GraphDisplayPath } from "@/lib/graph-path-display";

export type ViewNode = { key: string; label: string; title: string; version?: string; url?: string; sample?: boolean; x: number; y: number };
export type ViewEdge = { from: string; to: string; type: string };
export type GraphView = { nodes: ViewNode[]; edges: ViewEdge[]; width: number; height: number };

export const LABEL_COLORS: Record<string, string> = {
  Repository: "#43614b", Service: "#2f6f8f", File: "#8a8f7a", PullRequest: "#7a5ea8", Commit: "#9a7bc4",
  Incident: "#b5533c", Person: "#c08a2b", Team: "#a8742a", Decision: "#2e8a6d", Document: "#5f7f9a",
  Attempt: "#c26a8a", SecurityFinding: "#b83d3d", Dependency: "#7d7d4a", Vulnerability: "#a03030", Investigation: "#4a6fa5", Issue: "#a8703e", CheckRun: "#8a5a5a", Project: "#3f7f86",
};
export const labelColor = (label: string) => LABEL_COLORS[label] ?? "#6f7a68";

function hash(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) { value ^= text.charCodeAt(index); value = Math.imul(value, 16777619); }
  return (value >>> 0) / 4294967295;
}

// Small deterministic force layout (repulsion + spring + centring); no dependencies.
export function layoutGraph(input: { nodes: Omit<ViewNode, "x" | "y">[]; edges: ViewEdge[] }, width = 1000, height = 620): GraphView {
  const nodes: ViewNode[] = input.nodes.map((node) => ({ ...node, x: width / 2 + (hash(`${node.key}x`) - .5) * width * .6, y: height / 2 + (hash(`${node.key}y`) - .5) * height * .6 }));
  const index = new Map(nodes.map((node, position) => [node.key, position]));
  const edges = input.edges.filter((edge) => index.has(edge.from) && index.has(edge.to) && edge.from !== edge.to);
  const velocity = nodes.map(() => ({ x: 0, y: 0 }));
  const rest = Math.max(70, Math.min(150, 520 / Math.sqrt(Math.max(1, nodes.length))));
  const iterations = nodes.length > 120 ? 140 : 260;
  for (let step = 0; step < iterations; step++) {
    const cooling = 1 - step / iterations;
    for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
      let dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y;
      const distance2 = Math.max(dx * dx + dy * dy, 25);
      const force = 9000 / distance2, distance = Math.sqrt(distance2);
      dx /= distance; dy /= distance;
      velocity[a].x += dx * force; velocity[a].y += dy * force; velocity[b].x -= dx * force; velocity[b].y -= dy * force;
    }
    for (const edge of edges) {
      const a = index.get(edge.from)!, b = index.get(edge.to)!;
      const dx = nodes[b].x - nodes[a].x, dy = nodes[b].y - nodes[a].y;
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = (distance - rest) * .02;
      velocity[a].x += dx / distance * force; velocity[a].y += dy / distance * force; velocity[b].x -= dx / distance * force; velocity[b].y -= dy / distance * force;
    }
    nodes.forEach((node, position) => {
      velocity[position].x += (width / 2 - node.x) * .004; velocity[position].y += (height / 2 - node.y) * .006;
      node.x = Math.min(width - 50, Math.max(50, node.x + velocity[position].x * cooling));
      node.y = Math.min(height - 40, Math.max(40, node.y + velocity[position].y * cooling));
      velocity[position].x *= .6; velocity[position].y *= .6;
    });
  }
  // Stretch the settled layout to use the whole canvas so labels have room.
  if (nodes.length > 1) {
    const xs = nodes.map((node) => node.x), ys = nodes.map((node) => node.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (const node of nodes) {
      node.x = 70 + ((node.x - minX) / Math.max(maxX - minX, 1)) * (width - 140);
      node.y = 44 + ((node.y - minY) / Math.max(maxY - minY, 1)) * (height - 100);
    }
  }
  return { nodes, edges, width, height };
}

export function graphFromPaths(paths: GraphDisplayPath[]): GraphView {
  const nodes = new Map<string, Omit<ViewNode, "x" | "y">>();
  const edges = new Map<string, ViewEdge>();
  for (const path of paths) {
    path.nodes.forEach((node, position) => {
      const key = node.sourceId ?? node.id;
      if (!nodes.has(key)) nodes.set(key, { key, label: node.label, title: node.title, ...(node.version ? { version: node.version } : {}), ...(node.url ? { url: node.url } : {}) });
      const next = path.nodes[position + 1];
      if (next) {
        const nextKey = next.sourceId ?? next.id, type = path.relationships[position] ?? "RELATED_TO";
        edges.set(`${key}|${type}|${nextKey}`, { from: key, to: nextKey, type });
      }
    });
  }
  return layoutGraph({ nodes: [...nodes.values()], edges: [...edges.values()] }, 760, 360);
}

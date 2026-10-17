import assert from "node:assert/strict";
import { SAMPLE_EDGES, SAMPLE_NODES } from "../src/lib/sample-graph-data";
import { graphFromPaths, layoutGraph } from "../src/lib/graph-view";
import { graphPathsForDisplay } from "../src/lib/graph-path-display";

const ids = new Set(SAMPLE_NODES.map(([, id]) => id));
assert.equal(ids.size, SAMPLE_NODES.length, "sample node ids are unique");
for (const [from, type, to] of SAMPLE_EDGES) {
  assert.ok(ids.has(from) && ids.has(to), `${from} -${type}-> ${to} references existing nodes`);
  assert.match(type, /^[A-Z_]{1,40}$/);
}
for (const [label, id] of SAMPLE_NODES) { assert.match(label, /^[A-Za-z]{1,40}$/); assert.ok(id.startsWith("sample:"), "sample records are visibly namespaced"); }

const raw = [[
  [{ labels: ["Incident"], source_id: "a", title: "A" }, { labels: ["Service"], source_id: "b", title: "B" }, { labels: ["Person"], source_id: "c", title: "C" }],
  [{ type: "AFFECTS" }, { type: "OWNED_BY" }],
]];
const view = graphFromPaths(graphPathsForDisplay(raw));
assert.equal(view.nodes.length, 3);
assert.equal(view.edges.length, 2);
for (const node of view.nodes) assert.ok(node.x >= 0 && node.x <= view.width && node.y >= 0 && node.y <= view.height, "layout stays in bounds");
const again = graphFromPaths(graphPathsForDisplay(raw));
assert.deepEqual(again.nodes.map((n) => [n.x, n.y]), view.nodes.map((n) => [n.x, n.y]), "layout is deterministic");
assert.equal(layoutGraph({ nodes: [], edges: [] }).nodes.length, 0);
assert.equal(graphFromPaths([]).nodes.length, 0);
console.log("Graph view: sample graph is consistent and path-to-graph layout is bounded and deterministic.");

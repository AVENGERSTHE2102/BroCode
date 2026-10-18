import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildImpactRings } from "../src/components/graph-explorer";
import type { GraphDisplayPath } from "../src/lib/graph-path-display";

// buildImpactRings groups a blast-radius result's raw paths into hop "rings": ring 0 is the entity itself,
// ring 1 is everything one hop away, etc. This is the logic the cockpit uses to reveal the graph outward.
const paths: GraphDisplayPath[] = [
  { nodes: [{ id: "root" }, { id: "a" }, { id: "b" }], relationships: ["R1", "R2"] },
  { nodes: [{ id: "root" }, { id: "a" }, { id: "c" }], relationships: ["R1", "R3"] },
  { nodes: [{ id: "root" }, { id: "d" }], relationships: ["R4"] },
].map((path) => ({ nodes: path.nodes.map((node) => ({ ...node, label: "Entity", title: node.id })), relationships: path.relationships }));

const rings = buildImpactRings(paths);
assert.equal(rings.length, 3, "three rings: the entity itself, one hop out, two hops out");
assert.deepEqual(rings[0].nodeKeys, ["root"], "ring 0 is just the anchor entity");
assert.deepEqual(new Set(rings[1].nodeKeys), new Set(["a", "d"]), "ring 1 is everything directly connected");
assert.deepEqual(new Set(rings[2].nodeKeys), new Set(["b", "c"]), "ring 2 is everything two hops out");
assert.ok(rings[1].edgeKeys.includes("root|a") && rings[1].edgeKeys.includes("root|d"), "ring 1 edges reach from the anchor");
assert.ok(rings[2].edgeKeys.includes("a|b") && rings[2].edgeKeys.includes("a|c"), "ring 2 edges reach from ring 1");
assert.equal(buildImpactRings([]).length, 1, "an empty result still yields a single (empty) ring, never crashes");

const route = await readFile(new URL("../src/app/api/graph/impact/route.ts", import.meta.url), "utf8");
assert.match(route, /impactAnalysis/);
assert.match(route, /findExperts/);
assert.match(route, /graphPathsForDisplay/);
assert.match(route, /"Cache-Control": "no-store"/);

const explorer = await readFile(new URL("../src/components/graph-explorer.tsx", import.meta.url), "utf8");
assert.match(explorer, /runImpact/);
assert.match(explorer, /\/api\/graph\/impact/);
assert.match(explorer, /impact-panel/);
assert.match(explorer, /Blast radius/);
console.log("Blast-radius analysis groups paths into correct hop rings and is wired into the cockpit UI.");

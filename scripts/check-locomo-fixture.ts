import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

type EvalEdge = { id: string; from: string; to: string };
type EvalCase = {
  id: string;
  dimensions: string[];
  nodes: Array<{ id: string }>;
  edges: EvalEdge[];
  expected: { outcome: string; claims: string[]; evidencePaths: string[][]; requiredControls: string[] };
};

const fixture = JSON.parse(await readFile(new URL("../eval/locomo-external.v1.json", import.meta.url), "utf8")) as {
  version: number;
  dataClass: string;
  sourceAttribution: string;
  cases: EvalCase[];
};

assert.equal(fixture.version, 1);
assert.equal(fixture.dataClass, "external_benchmark_locomo_subset", "LoCoMo-derived cases must be labeled as external benchmark data, never as synthetic_test_fixture_only");
assert.ok(fixture.sourceAttribution.includes("locomo"), "external benchmark fixture must cite its source");
assert.ok(fixture.cases.length >= 1);

const ids = new Set<string>();
for (const item of fixture.cases) {
  assert.ok(item.id && !ids.has(item.id), `duplicate or empty case id: ${item.id}`);
  ids.add(item.id);
  const nodes = new Set(item.nodes.map((node) => node.id));
  const edges = new Map(item.edges.map((edge) => [edge.id, edge]));
  assert.equal(nodes.size, item.nodes.length, `${item.id}: duplicate node id`);
  assert.equal(edges.size, item.edges.length, `${item.id}: duplicate edge id`);
  assert.ok(item.edges.every((edge) => nodes.has(edge.from) && nodes.has(edge.to)), `${item.id}: edge has a missing endpoint`);
  assert.ok(item.expected.outcome && item.expected.requiredControls.length > 0, `${item.id}: expected behavior is underspecified`);
  if (item.expected.outcome === "abstain") {
    assert.equal(item.expected.claims.length, 0, `${item.id}: an abstain case must not expect claims`);
  }
  for (const path of item.expected.evidencePaths) {
    assert.ok(path.length >= 3 && path.length % 2 === 1, `${item.id}: evidence path must alternate node and edge IDs`);
    for (let index = 0; index < path.length; index += 2) {
      assert.ok(nodes.has(path[index]), `${item.id}: evidence path references a missing node`);
      if (index + 1 < path.length) {
        const edge = edges.get(path[index + 1]);
        assert.ok(edge && ((edge.from === path[index] && edge.to === path[index + 2]) || (edge.to === path[index] && edge.from === path[index + 2])), `${item.id}: evidence path is not connected`);
      }
    }
  }
}

console.log(`LoCoMo-derived external evaluation cases validated: ${fixture.cases.length}`);

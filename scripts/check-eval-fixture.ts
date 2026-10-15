import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

type EvalEdge = { id: string; from: string; to: string };
type EvalCase = {
  id: string;
  dimensions: string[];
  principalRole?: string;
  nodes: Array<{ id: string; aclRole?: string }>;
  edges: Array<EvalEdge & { aclRole?: string }>;
  expected: { outcome: string; claims: string[]; evidencePaths: string[][]; restrictedPaths?: string[][]; requiredControls: string[] };
};

const fixtureFiles = ["engineering-incidents.v1.json", "domain-workflows.v1.json"];
const fixtures = await Promise.all(fixtureFiles.map(async (file) => JSON.parse(await readFile(new URL(`../eval/${file}`, import.meta.url), "utf8")) as {
  version: number;
  dataClass: string;
  cases: EvalCase[];
}));
const cases = fixtures.flatMap((fixture) => fixture.cases);
const requiredDimensions = ["multi_hop", "changing_facts", "prior_failures", "restart_recovery", "handoff", "missing_evidence", "access_control", "deletion", "fraud", "security", "codebase"];
const ids = new Set<string>();
const observedDimensions = new Set(cases.flatMap((item) => item.dimensions));

assert(fixtures.every((fixture) => fixture.version === 1 && fixture.dataClass === "synthetic_test_fixture_only"));
assert.ok(cases.length >= requiredDimensions.length);
assert.ok(requiredDimensions.every((dimension) => observedDimensions.has(dimension)), "evaluation fixture misses a required research dimension");

for (const item of cases) {
  assert.ok(item.id && !ids.has(item.id), `duplicate or empty case id: ${item.id}`);
  ids.add(item.id);
  const nodes = new Set(item.nodes.map((node) => node.id));
  const edges = new Map(item.edges.map((edge) => [edge.id, edge]));
  assert.equal(nodes.size, item.nodes.length, `${item.id}: duplicate node id`);
  assert.equal(edges.size, item.edges.length, `${item.id}: duplicate edge id`);
  assert.ok(item.edges.every((edge) => nodes.has(edge.from) && nodes.has(edge.to)), `${item.id}: edge has a missing endpoint`);
  assert.ok(item.expected.outcome && item.expected.requiredControls.length > 0, `${item.id}: expected behavior is underspecified`);
  const verifyPath = (path: string[]) => {
    assert.ok(path.length >= 3 && path.length % 2 === 1, `${item.id}: evidence path must alternate node and edge IDs`);
    for (let index = 0; index < path.length; index += 2) {
      assert.ok(nodes.has(path[index]), `${item.id}: evidence path references a missing node`);
      if (index + 1 < path.length) {
        const edge = edges.get(path[index + 1]);
        assert.ok(edge && ((edge.from === path[index] && edge.to === path[index + 2]) || (edge.to === path[index] && edge.from === path[index + 2])), `${item.id}: evidence path is not connected`);
      }
    }
    return path;
  };
  for (const path of item.expected.evidencePaths) verifyPath(path);
  for (const path of item.expected.restrictedPaths ?? []) {
    verifyPath(path);
    const inaccessibleNode = path.filter((_, index) => index % 2 === 0).some((id) => {
      const node = item.nodes.find((candidate) => candidate.id === id);
      return node?.aclRole !== "workspace" && node?.aclRole !== item.principalRole;
    });
    const inaccessibleEdge = path.filter((_, index) => index % 2 === 1).some((id) => {
      const edge = item.edges.find((candidate) => candidate.id === id);
      return edge?.aclRole !== "workspace" && edge?.aclRole !== item.principalRole;
    });
    assert.ok(inaccessibleNode || inaccessibleEdge, `${item.id}: restricted path is visible to the principal`);
  }
}

console.log(`Research-linked synthetic evaluation cases validated: ${cases.length}`);

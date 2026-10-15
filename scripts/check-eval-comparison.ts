import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { collectEvalEvidence, expectedPathCoverage, lexicalClaimScores, markdownEvalMemory, retrieveEvalText, visibleEvalRecords, type EvalCase } from "../src/lib/evaluation";

const fixture = JSON.parse(await readFile(new URL("../eval/domain-workflows.v1.json", import.meta.url), "utf8")) as { cases: EvalCase[] };
const fraud = fixture.cases.find((item) => item.id === "fraud-transfer-network-triage");
assert.ok(fraud);
const records = visibleEvalRecords(fraud);
assert.ok(records.some((record) => record.id === "tx-900"));
assert.ok(records.some((record) => record.id === "f-e3"));
assert.equal(records.some((record) => record.text.includes("aclGroups")), false);
const retrieved = retrieveEvalText(records, fraud.question);
assert.ok(retrieved.length > 0 && retrieved.length <= 12);
assert.equal(markdownEvalMemory(records).includes("source fraud-transfer-network-triage:edge:f-e1 @ ledger:44"), true);
assert.equal(expectedPathCoverage(fraud.expected.evidencePaths, new Set(fraud.expected.evidencePaths[0])), 1);
assert.equal(expectedPathCoverage(fraud.expected.evidencePaths, new Set(["tx-900"])), 0);
assert.ok(lexicalClaimScores(fraud.expected.claims, fraud.expected.claims).f1 > 0.99);

const restricted: EvalCase = {
  id: "acl-test", question: "Inspect the linked entity.", principalRole: "member", nodes: [
    { id: "public", aclRole: "workspace" }, { id: "private", aclRole: "owner" },
  ], edges: [{ id: "secret-link", from: "public", to: "private" }], expected: { claims: [], evidencePaths: [] },
};
const restrictedRecords = visibleEvalRecords(restricted);
assert.deepEqual(restrictedRecords.map((record) => record.id), ["public"]);
const hostile = collectEvalEvidence({ resolved: false, ambiguous: true, candidates: [{ id: "hidden", sourceId: "hidden", version: "1" }] });
assert.equal(hostile.records.size, 0);
assert.equal(hostile.refs.size, 0);

console.log("Evaluation comparison enforces fixture ACLs and reports deterministic retrieval, path, and lexical metrics.");

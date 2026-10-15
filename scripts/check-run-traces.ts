import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildMcpTracePayload } from "../src/lib/mcp-trace";
import { finishRunTrace, recordToolCallTrace, startRunTrace } from "@/lib/run-traces";

const request = new Request("http://localhost");
const invalidCalls = [
  () => startRunTrace(request, null as never),
  () => recordToolCallTrace(request, null as never),
  () => finishRunTrace(request, null as never),
  () => startRunTrace(request, { runId: "00000000-0000-4000-8000-000000000001" } as never),
  () => startRunTrace(request, { investigationId: "00000000-0000-4000-8000-000000000001", runId: "00000000-0000-4000-8000-000000000002", model: "m", modelRevision: "m", promptRevision: "p", contextRefs: [], availableTools: ["unknown_tool"], idempotencyKey: "start-1" }),
  () => recordToolCallTrace(request, { runId: "invalid" } as never),
  () => finishRunTrace(request, { runId: "invalid" } as never),
];

for (const call of invalidCalls) {
  const result = await call();
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
}

const runRoute = await readFile(new URL("../src/app/api/investigations/[id]/run/route.ts", import.meta.url), "utf8");
const traceService = await readFile(new URL("../src/lib/run-traces.ts", import.meta.url), "utf8");
const investigationDetail = await readFile(new URL("../src/app/investigation-detail.tsx", import.meta.url), "utf8");
assert.match(runRoute, /availableTools: selectedToolNames/);
assert.match(traceService, /availableTools: input\.availableTools/);
assert.match(investigationDetail, /Tools available to this run: \{availableTools\}/);

const quarantined = buildMcpTracePayload({ investigationId: "inv-1", factKey: "release_status", value: "unreviewed source text",
  provenance: [{ sourceId: "source-1", version: "v2" }], expectedVersion: 0, idempotencyKey: "candidate-1" },
{ ok: true, value: { candidate: { id: "candidate-1", fact_key: "release_status", status: "pending" } } }, "remember_fact");
assert.equal(JSON.stringify(quarantined).includes("unreviewed source text"), false);
assert.equal((quarantined.input as Record<string, unknown>).candidateContentQuarantined, true);

console.log(`Malformed run-trace inputs rejected: ${invalidCalls.length}/${invalidCalls.length}; quarantined fact content omitted from traces.`);

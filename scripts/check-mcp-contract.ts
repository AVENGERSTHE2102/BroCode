import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mcpTools } from "../src/lib/mcp-tools";
import { POST } from "../src/app/api/mcp/route";
import { getMcpPrompt, listMcpPrompts } from "../src/lib/mcp-prompts";
import { buildMcpTracePayload } from "../src/lib/mcp-trace";
import { decodeGraphPathRows, graphPathsForDisplay } from "../src/lib/graph-path-display";
import { MCP_MODERN_VERSION, mcpModernResult, validateMcpProtocolRequest } from "../src/lib/mcp-protocol";

const mcpRoute = await readFile(new URL("../src/app/api/mcp/route.ts", import.meta.url), "utf8");

assert.deepEqual(mcpTools.map((tool) => tool.name), ["resolve_entity", "trace_entity", "recall_facts", "recall_attempts", "remember_fact", "create_task", "list_tasks", "claim_task", "handoff_task", "acknowledge_task_handoff", "complete_task", "propose_action", "explain_evidence"]);
assert(mcpTools.every((tool) => tool.inputSchema.additionalProperties === false));
assert(mcpTools.filter((tool) => ["resolve_entity", "trace_entity", "recall_facts", "recall_attempts", "list_tasks", "explain_evidence"].includes(tool.name)).every((tool) => tool.annotations.readOnlyHint));
assert(mcpTools.filter((tool) => ["remember_fact", "create_task", "handoff_task", "propose_action"].includes(tool.name)).every((tool) => tool.annotations.readOnlyHint === false && tool.annotations.idempotentHint && tool.annotations.destructiveHint === false));
assert(mcpTools.filter((tool) => ["claim_task", "acknowledge_task_handoff", "complete_task"].includes(tool.name)).every((tool) => tool.annotations.readOnlyHint === false && tool.annotations.idempotentHint && tool.annotations.destructiveHint === false));
assert(mcpTools.find((tool) => tool.name === "propose_action")?.description.includes("does not approve or execute"));
assert(mcpTools.find((tool) => tool.name === "propose_action")?.description.includes("different targetRevision"));
assert.deepEqual(Object.keys(mcpTools.find((tool) => tool.name === "propose_action")?.inputSchema.properties.target?.properties ?? {}),
  ["repository", "ref", "baseSha", "provider", "serviceId", "environment", "currentRevision", "targetRevision"]);
assert(mcpTools.every((tool) => tool.inputSchema.required.length > 0));
const trace = buildMcpTracePayload({ investigationId: "inv-1" }, { data: [{ id: "node-1" }] }, "trace_entity");
assert.deepEqual(trace.graphPaths, [{ id: "node-1" }]);
assert.deepEqual(trace.evidenceIds, ["node-1"]);
const encodedPathRows = [[JSON.stringify([
  { id: "repo-id", source_id: "github:repo:321", labels: ["Repository"] },
  { id: "finding-id", source_id: "ghsa-1", labels: ["SecurityFinding"] },
]), JSON.stringify([{ type: "HAS_SECURITY_FINDING" }])]];
const decodedPathRows = decodeGraphPathRows(encodedPathRows);
assert.equal(decodedPathRows.length, 1);
const wrappedTrace = buildMcpTracePayload({ investigationId: "inv-1" }, {
  ok: true, value: { workspaceId: "workspace-1", data: [[
    ...decodedPathRows[0],
  ]] },
}, "trace_entity");
assert.deepEqual(wrappedTrace.graphPaths, [[
  [{ id: "repo-id", source_id: "github:repo:321", labels: ["Repository"] }, { id: "finding-id", source_id: "ghsa-1", labels: ["SecurityFinding"] }],
  [{ type: "HAS_SECURITY_FINDING" }],
]]);
assert.deepEqual(wrappedTrace.evidenceIds, ["repo-id", "github:repo:321", "finding-id", "ghsa-1"]);
assert.deepEqual(graphPathsForDisplay(wrappedTrace.graphPaths)[0].relationships, ["HAS_SECURITY_FINDING"]);
const displayPath = graphPathsForDisplay([[
  [{ labels: ["Repository"], id: "repo-id", source_id: "github:repo:321", title: "acme/service", source_url: "https://github.com/acme/service", source_version: "main" },
    { labels: ["SecurityFinding"], id: "finding-id", source_id: "github:security:321:17", title: "GHSA alert", source_url: "https://github.com.attacker.example/fake" }],
  [{ type: "HAS_SECURITY_FINDING" }],
]]);
assert.equal(displayPath.length, 1);
assert.equal(displayPath[0].nodes[0].url, "https://github.com/acme/service");
assert.equal(displayPath[0].nodes[1].url, undefined);
assert.deepEqual(displayPath[0].relationships, ["HAS_SECURITY_FINDING"]);
const unresolvedTrace = buildMcpTracePayload({ investigationId: "inv-1" }, {
  value: { resolved: false, ambiguous: true, candidates: [{ source_id: "candidate-1", source_version: "rev-2" }] },
}, "resolve_entity");
assert.deepEqual(unresolvedTrace.evidenceIds, []);
const oversized = buildMcpTracePayload({ investigationId: "inv-1", patch: "x".repeat(13_000) }, { id: "event-1", payload: "x".repeat(15_000) }, "propose_action");
assert.equal(oversized.truncated, true);
assert.equal(JSON.stringify(oversized.input).includes("x".repeat(100)), false);
assert.deepEqual(oversized.evidenceIds, ["event-1"]);

const modernMessage = { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "resolve_entity", _meta: { "io.modelcontextprotocol/protocolVersion": MCP_MODERN_VERSION } } };
const modernHeaders = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": MCP_MODERN_VERSION, "mcp-method": "tools/call", "mcp-name": "resolve_entity" };
assert.deepEqual(validateMcpProtocolRequest(new Request("https://waypoint.example/api/mcp", { headers: modernHeaders }), modernMessage), { ok: true, modern: true });
assert.equal(validateMcpProtocolRequest(new Request("https://waypoint.example/api/mcp", { headers: { ...modernHeaders, "mcp-name": "propose_action" } }), modernMessage).ok, false);
assert.equal(validateMcpProtocolRequest(new Request("https://waypoint.example/api/mcp", { headers: { "mcp-protocol-version": MCP_MODERN_VERSION } }), modernMessage).ok, false);
assert.equal(validateMcpProtocolRequest(new Request("https://waypoint.example/api/mcp"), { method: "initialize" }).ok, true);
const modernDiscovery = mcpModernResult({ supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: { listChanged: false } } }, true);
assert.equal(modernDiscovery.resultType, "complete");
assert.equal(modernDiscovery.cacheScope, "private");
assert.equal((modernDiscovery._meta as Record<string, Record<string, string>>)["io.modelcontextprotocol/serverInfo"].name, "waypoint");
assert.equal("ttlMs" in mcpModernResult({ isError: false }), false);

const prompts = listMcpPrompts();
assert.deepEqual(prompts.map((prompt) => prompt.name), ["investigate_fraud", "triage_security_finding", "investigate_codebase_change"]);
assert(prompts.every((prompt) => prompt.arguments.every((argument) => argument.required)));
const investigationId = "00000000-0000-4000-8000-000000000001";
const fraudPrompt = getMcpPrompt("investigate_fraud", { investigationId, question: "Review this transfer." });
assert.match(fraudPrompt?.messages[0].content.text ?? "", /risk signals, never proof of intent/i);
assert.match(fraudPrompt?.messages[0].content.text ?? "", /Review this transfer/);
assert.equal(getMcpPrompt("investigate_fraud", { investigationId, question: "  " }), null);
assert.equal(getMcpPrompt("investigate_fraud", { investigationId, question: "task", role: "admin" }), null);
assert.match(mcpRoute, /message\.method === "prompts\/list"/);
assert.match(mcpRoute, /message\.method === "prompts\/get"/);
assert.match(mcpRoute, /prompts: \{ listChanged: false \}/);
const promptHeaders = { ...modernHeaders, "mcp-method": "prompts/get", "mcp-name": "investigate_fraud" };
const promptMessage = { jsonrpc: "2.0", id: 6, method: "prompts/get", params: { name: "investigate_fraud", _meta: { "io.modelcontextprotocol/protocolVersion": MCP_MODERN_VERSION } } };
assert.deepEqual(validateMcpProtocolRequest(new Request("https://waypoint.example/api/mcp", { headers: promptHeaders }), promptMessage), { ok: true, modern: true });
assert.equal(validateMcpProtocolRequest(new Request("https://waypoint.example/api/mcp", { headers: { ...promptHeaders, "mcp-name": "triage_security_finding" } }), promptMessage).ok, false);

const malformed = await POST(new Request("https://waypoint.example/api/mcp", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: "{",
}));
assert.equal(malformed.status, 200);
assert.deepEqual(await malformed.json(), { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } });

const badOrigin = await POST(new Request("https://waypoint.example/api/mcp", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", origin: "https://attacker.example" },
  body: "{}",
}));
assert.equal(badOrigin.status, 403);

console.log("MCP contract checks passed.");

import assert from "node:assert/strict";
// @ts-expect-error Bun provides this test-only module at runtime; app types use Node declarations.
import { mock } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

mock.module("@/lib/workspace", () => ({
  resolveWorkspace: async () => ({
    ok: true,
    workspace: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "SDK conformance fixture",
      role: "owner",
      graphName: "wp_11111111111141118111111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
    },
  }),
}));

const { POST } = await import("../src/app/api/mcp/route");
const client = new Client({ name: "waypoint-sdk-contract", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL("https://waypoint.example/api/mcp"), {
  requestInit: { headers: { authorization: "Bearer conformance-fixture" } },
  fetch: async (input, init) => POST(new Request(input, init)),
});

try {
  await client.connect(transport);
  const [{ tools }, { prompts }] = await Promise.all([client.listTools(), client.listPrompts()]);
  assert.deepEqual(tools.map(({ name }) => name), [
    "resolve_entity", "trace_entity", "recall_facts", "recall_attempts", "remember_fact",
    "create_task", "list_tasks", "claim_task", "handoff_task", "acknowledge_task_handoff",
    "complete_task", "propose_action", "explain_evidence", "search_entities", "graph_overview", "find_experts", "impact_analysis", "shortest_path",
  ]);
  assert.deepEqual(prompts.map(({ name }) => name), [
    "investigate_fraud", "triage_security_finding", "investigate_codebase_change",
  ]);
  const prompt = await client.getPrompt({
    name: "triage_security_finding",
    arguments: { investigationId: "33333333-3333-4333-8333-333333333333", question: "Assess this finding." },
  });
  assert.equal(prompt.messages.length, 1);
  const promptContent = prompt.messages[0].content;
  assert.equal(promptContent.type, "text");
  if (promptContent.type === "text") assert.match(promptContent.text, /Assess this finding\./);
  console.log(`Official MCP SDK connected; discovered ${tools.length} tools and ${prompts.length} prompts.`);
} finally {
  await client.close();
}

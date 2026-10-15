import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { finishAgentRun, startAgentRun, traceAgentToolCall } from "@/lib/agent-tools";
import { invokeMcpTool, mcpToolKinds } from "@/lib/mcp-dispatch";
import { mcpTools } from "@/lib/mcp-tools";
import { getMcpPrompt, listMcpPrompts } from "@/lib/mcp-prompts";
import { buildMcpTracePayload } from "@/lib/mcp-trace";
import { MCP_LEGACY_VERSIONS, MCP_MODERN_VERSION, mcpModernResult, validateMcpProtocolRequest } from "@/lib/mcp-protocol";
import { resolveWorkspace } from "@/lib/workspace";
import { readJsonBody } from "@/lib/read-json-body";

export const runtime = "nodejs";

type RpcMessage = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
const rpcError = (id: unknown, code: number, message: string) => NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function validOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(request: Request) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Origin is not allowed." }, { status: 403 });
  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  if (contentType !== "application/json") return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) return NextResponse.json({ error: "Accept must include application/json and text/event-stream." }, { status: 406 });
  const parsed = await readJsonBody(request, 65_536);
  if (!parsed.ok) return parsed.reason === "too_large"
    ? NextResponse.json({ error: "Request body is too large." }, { status: 413 })
    : rpcError(null, -32700, "Parse error.");
  const message = parsed.value as RpcMessage;
  if (!isRecord(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string"
    || ("id" in message && !(typeof message.id === "string" || (typeof message.id === "number" && Number.isFinite(message.id))))
    || (!message.method.startsWith("notifications/") && !("id" in message))) return rpcError(message?.id, -32600, "Invalid Request.");
  if (("id" in message && message.method.startsWith("notifications/")) || (!("id" in message) && !message.method.startsWith("notifications/"))) return rpcError(message.id, -32600, "Invalid Request.");

  const protocol = validateMcpProtocolRequest(request, message);
  if (!protocol.ok) return NextResponse.json({ jsonrpc: "2.0", id: message.id ?? null, error: { code: protocol.code, message: protocol.message } }, { status: 400 });

  const access = await resolveWorkspace(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: access.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined });

  if (message.method === "notifications/initialized" || message.method.startsWith("notifications/")) return new Response(null, { status: 202 });
  if (protocol.modern && message.method === "initialize") return rpcError(message.id, -32601, "Method not found.");
  const respond = (result: Record<string, unknown>, cacheable = false) => NextResponse.json({
    jsonrpc: "2.0", id: message.id ?? null, result: protocol.modern ? mcpModernResult(result, cacheable) : result,
  });
  if (protocol.modern && message.method === "server/discover") return respond({
    supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
  }, true);
  if (message.method === "initialize") {
    const params = isRecord(message.params) ? message.params : {};
    const requested = params.protocolVersion;
    const selected = typeof requested === "string" && MCP_LEGACY_VERSIONS.includes(requested) ? requested : MCP_LEGACY_VERSIONS[0];
    return NextResponse.json({ jsonrpc: "2.0", id: message.id ?? null, result: { protocolVersion: selected, capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } }, serverInfo: { name: "waypoint", version: "0.1.0" } } });
  }
  if (!protocol.modern && message.method === "ping") return respond({});
  if (message.method === "tools/list") return respond({ tools: mcpTools }, true);
  if (message.method === "prompts/list") return respond({ prompts: listMcpPrompts() }, true);
  if (message.method === "prompts/get") {
    const params = isRecord(message.params) ? message.params : {};
    const prompt = getMcpPrompt(params.name, params.arguments);
    return prompt ? respond(prompt) : rpcError(message.id, -32602, "Prompt name or arguments are invalid.");
  }
  if (message.method !== "tools/call") return rpcError(message.id, -32601, "Method not found.");

  const params = isRecord(message.params) ? message.params : {};
  if (typeof params.name !== "string") return rpcError(message.id, -32602, "Tool name is required.");
  if (!mcpTools.some((tool) => tool.name === params.name)) return rpcError(message.id, -32602, "Unknown tool.");
  if (!isRecord(params.arguments) || typeof params.arguments.investigationId !== "string") return rpcError(message.id, -32602, "An investigation ID is required for tool execution.");
  const args = params.arguments;
  const investigationId = args.investigationId as string;
  const runId = randomUUID();
  const protocolVersion = request.headers.get("mcp-protocol-version");
  const protocolRevision = protocolVersion ?? "client-unspecified";
  let started: Awaited<ReturnType<typeof startAgentRun>>;
  try {
    started = await startAgentRun(request, {
      investigationId, runId, model: "external MCP client", modelRevision: protocolRevision,
      promptRevision: "client-managed", contextRefs: [`investigation:${investigationId}`], availableTools: [params.name],
      idempotencyKey: `mcp:${runId}:start`,
    });
  } catch { return NextResponse.json({ jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: "Run trace could not be started; tool was not executed." }] } }); }
  if (!started.ok) return NextResponse.json({ jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: "Run trace could not be started; tool was not executed." }] } });

  let tool: Awaited<ReturnType<typeof invokeMcpTool>>;
  try { tool = await invokeMcpTool(request, params.name, args); }
  catch { tool = { ok: false as const, status: 503 as const, error: "Tool execution failed." }; }
  if (tool === null) tool = { ok: false as const, status: 400 as const, error: "Unknown tool." };
  const value = tool.ok ? ("value" in tool ? tool.value : "data" in tool ? tool.data : tool) : { error: tool.error };
  const trace = buildMcpTracePayload(args, value, params.name);
  let traced: Awaited<ReturnType<typeof traceAgentToolCall>>;
  try {
    traced = await traceAgentToolCall(request, {
      investigationId, runId, sequence: 1, tool: mcpToolKinds[params.name], input: trace.input,
      output: trace.output, evidenceIds: trace.evidenceIds, graphPaths: trace.graphPaths,
      modelRevision: protocolRevision, promptRevision: "client-managed", truncated: trace.truncated,
      idempotencyKey: `mcp:${runId}:call`,
    });
  } catch { traced = { ok: false as const, status: 503 as const, error: "Run trace storage is unavailable." }; }
  let finished: Awaited<ReturnType<typeof finishAgentRun>> | null = null;
  if (traced.ok) {
    try {
      finished = await finishAgentRun(request, {
        investigationId, runId, status: tool.ok ? "completed" : "failed",
        summary: tool.ok ? `MCP tool ${params.name} completed.` : `MCP tool ${params.name} failed.`,
        truncated: trace.truncated, idempotencyKey: `mcp:${runId}:finish`,
      });
    } catch { finished = null; }
  } else {
    try {
      finished = await finishAgentRun(request, {
        investigationId, runId, status: "failed", summary: "MCP tool run trace could not be persisted.",
        truncated: true, idempotencyKey: `mcp:${runId}:finish`,
      });
    } catch { finished = null; }
  }
  if (!traced.ok || !finished?.ok) return respond({ isError: true, content: [{ type: "text", text: "Tool execution or run-trace persistence failed. Retry a state-changing tool only with the same idempotency key." }] });
  if (!tool.ok) return respond({ isError: true, content: [{ type: "text", text: tool.error }] });
  return respond({ isError: false, content: [{ type: "text", text: JSON.stringify(value) }] });
}

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AGENT_PROMPT_REVISION, completeWithModel, openAiToolDefinitions, readModelConfig, runToolSelectionLoop, selectAgentToolNames, type AgentWritePermissions } from "@/lib/agent-runner";
import { finishAgentRun, startAgentRun, traceAgentToolCall } from "@/lib/agent-tools";
import { invokeMcpTool, mcpToolKinds } from "@/lib/mcp-dispatch";
import { buildMcpTracePayload } from "@/lib/mcp-trace";
import { readJsonBody } from "@/lib/read-json-body";
import { workspaceSupabase } from "@/lib/workspace-supabase";
import { isWorkflowDomain } from "@/lib/workflow-domains";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class InvestigationDeletedError extends Error {}

export async function POST(request: Request, { params }: Context) {
  const access = await workspaceSupabase(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const config = readModelConfig();
  if (!config) return NextResponse.json({ error: "The server-side model provider is not configured." }, { status: 503 });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });

  const parsed = await readJsonBody(request, 16_384);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === "too_large" ? "Request body is too large." : "Request body must be valid JSON." }, { status: parsed.reason === "too_large" ? 413 : 400 });
  const body = parsed.value;
  if (typeof body !== "object" || body === null || Array.isArray(body) || !("question" in body)
    || typeof body.question !== "string" || !body.question.trim() || body.question.length > 4000
    || !("idempotencyKey" in body) || typeof body.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(body.idempotencyKey)) {
    return NextResponse.json({ error: "A question, valid idempotency key, and optional valid run ID are required." }, { status: 400 });
  }
  const requestedRunId = "runId" in body ? body.runId : undefined;
  if (requestedRunId !== undefined && (typeof requestedRunId !== "string" || !UUID.test(requestedRunId))) {
    return NextResponse.json({ error: "Run ID is invalid." }, { status: 400 });
  }
  const requestedWrites = (body as Record<string, unknown>).requestedWrites;
  const allowedWriteKeys = new Set(["proposals", "factCandidates", "taskUpdates"]);
  if (requestedWrites !== undefined && (typeof requestedWrites !== "object" || requestedWrites === null || Array.isArray(requestedWrites)
    || Object.entries(requestedWrites).some(([key, value]) => !allowedWriteKeys.has(key) || typeof value !== "boolean"))) {
    return NextResponse.json({ error: "Requested write permissions are invalid." }, { status: 400 });
  }
  const writePermissions = (requestedWrites ?? {}) as AgentWritePermissions;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Investigation ID is invalid." }, { status: 400 });
  const { data: investigation, error: investigationError } = await access.supabase.from("investigations")
    .select("workflow_domain").eq("workspace_id", access.workspace.id).eq("id", id).maybeSingle();
  if (investigationError) return NextResponse.json({ error: "Investigation workflow could not be loaded." }, { status: 503 });
  if (!investigation) return NextResponse.json({ error: "Investigation not found." }, { status: 404 });
  const workflowDomain = isWorkflowDomain(investigation.workflow_domain) ? investigation.workflow_domain : "general";
  const assertInvestigationLive = async () => {
    if (request.signal.aborted) throw new Error("Agent run was cancelled.");
    const { data, error } = await access.supabase.from("investigations").select("id")
      .eq("workspace_id", access.workspace.id).eq("id", id).maybeSingle();
    if (error) throw new Error("Investigation status could not be checked.");
    if (!data) throw new InvestigationDeletedError("Investigation was deleted.");
  };
  try { await assertInvestigationLive(); }
  catch (error) {
    if (error instanceof InvestigationDeletedError) return NextResponse.json({ error: error.message }, { status: 410 });
    return NextResponse.json({ error: "Investigation access could not be checked." }, { status: 503 });
  }
  const selectedToolNames = [...selectAgentToolNames(body.question.trim(), writePermissions)];
  const runId = typeof requestedRunId === "string" ? requestedRunId : randomUUID();
  let started;
  try {
    started = await startAgentRun(request, {
      investigationId: id, runId, model: config.model, modelRevision: config.model,
      promptRevision: AGENT_PROMPT_REVISION, contextRefs: [`investigation:${id}`, `workflow:${workflowDomain}`], availableTools: selectedToolNames,
      idempotencyKey: `agent:${runId}:start`,
    });
  } catch { started = null; }
  if (!started?.ok) return NextResponse.json({ error: "Investigation run could not be recorded." }, { status: 503 });

  try {
    const evidenceIds = new Set<string>();
    let traceTruncated = false;
    const selectedTools = openAiToolDefinitions(new Set(selectedToolNames));
    const result = await runToolSelectionLoop(body.question.trim(), id, selectedTools, {
      complete: async (messages, tools) => {
        await assertInvestigationLive();
        const completion = await completeWithModel(messages, tools, config, request.signal);
        await assertInvestigationLive();
        return completion;
      },
      invoke: async (name, args) => {
        await assertInvestigationLive();
        const result = await invokeMcpTool(request, name, args);
        await assertInvestigationLive();
        return result;
      },
      onToolCall: async ({ name, args, result: output, sequence }) => {
        await assertInvestigationLive();
        const trace = buildMcpTracePayload(args, output, name);
        trace.evidenceIds.forEach((evidenceId) => { if (evidenceIds.size < 100) evidenceIds.add(evidenceId); });
        traceTruncated ||= trace.truncated;
        const recorded = await traceAgentToolCall(request, {
          investigationId: id, runId, sequence, tool: mcpToolKinds[name], input: trace.input,
          output: trace.output, evidenceIds: trace.evidenceIds, graphPaths: trace.graphPaths,
          modelRevision: config.model, promptRevision: AGENT_PROMPT_REVISION, truncated: trace.truncated,
          idempotencyKey: `agent:${runId}:tool:${sequence}`,
        });
        if (!recorded.ok) throw new Error("Tool execution trace could not be stored.");
        await assertInvestigationLive();
      },
    }, { operationKey: `${access.workspace.id}:${id}:${body.idempotencyKey}`, workflowDomain });
    await assertInvestigationLive();
    const outputTruncated = result.answer.length > 2000;
    const finished = await finishAgentRun(request, {
      investigationId: id, runId, status: "completed", summary: result.answer.slice(0, 2000) || "Completed without a text answer.",
      truncated: outputTruncated || traceTruncated, idempotencyKey: `agent:${runId}:finish`,
    });
    if (!finished.ok) return NextResponse.json({ error: "Run finished, but its completion trace could not be stored.", runId }, { status: 503 });
    await assertInvestigationLive();
    return NextResponse.json({ runId, answer: result.answer, abstained: result.abstained, actionAcknowledged: result.actionAcknowledged, uncertainty: result.uncertainty,
      claims: result.claims, alternatives: result.alternatives, citations: result.citations, usedTools: result.usedTools, toolCalls: result.toolCalls,
      evidenceIds: [...evidenceIds], traceUrl: `/api/investigations/${id}/runs`, truncated: outputTruncated || traceTruncated });
  } catch (error) {
    await finishAgentRun(request, {
      investigationId: id, runId, status: "failed", summary: "Investigation run failed; inspect recorded tool calls before retrying.",
      truncated: false, idempotencyKey: `agent:${runId}:finish`,
    }).catch(() => null);
    if (error instanceof InvestigationDeletedError) return NextResponse.json({ error: "Investigation was deleted; the active run was stopped." }, { status: 410 });
    return NextResponse.json({ error: "Investigation run failed; inspect run history before retrying.", runId }, { status: 502 });
  }
}

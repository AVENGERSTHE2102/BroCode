import { appendInvestigationEvent } from "@/lib/investigations";
import { mcpTools } from "@/lib/mcp-tools";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOOL_NAMES = new Set(["resolve", "trace", "recall", "remember", "task", "propose_action", "explain"]);
const AGENT_TOOL_NAMES = new Set(mcpTools.map((tool) => tool.name));

function sizedJson(value: unknown, limit: number) {
  try {
    const json = JSON.stringify(value);
    return json !== undefined && new TextEncoder().encode(json).byteLength <= limit;
  } catch {
    return false;
  }
}

function boundedText(value: unknown, max: number) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function validInvestigationId(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export type StartRunInput = {
  investigationId: string;
  runId: string;
  model: string;
  modelRevision: string;
  promptRevision: string;
  contextRefs: string[];
  availableTools: string[];
  idempotencyKey: string;
};

export async function startRunTrace(request: Request, input: StartRunInput) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || !validInvestigationId(input.investigationId) || !UUID_PATTERN.test(input.runId) || !boundedText(input.model, 160)
    || !boundedText(input.modelRevision, 160) || !boundedText(input.promptRevision, 160)
    || !Array.isArray(input.contextRefs) || input.contextRefs.length > 100
    || input.contextRefs.some((ref) => !boundedText(ref, 300)) || !Array.isArray(input.availableTools)
    || input.availableTools.length > AGENT_TOOL_NAMES.size
    || input.availableTools.some((tool) => !AGENT_TOOL_NAMES.has(tool))
    || new Set(input.availableTools).size !== input.availableTools.length || !boundedText(input.idempotencyKey, 160)) {
    return { ok: false as const, status: 400 as const, error: "Run trace metadata is invalid." };
  }
  return appendInvestigationEvent(request, input.investigationId, {
    type: "run_started",
    idempotencyKey: input.idempotencyKey,
    payload: {
      runId: input.runId, model: input.model.trim(), modelRevision: input.modelRevision.trim(),
      promptRevision: input.promptRevision.trim(), contextRefs: input.contextRefs, availableTools: input.availableTools,
    },
  });
}

export type ToolCallTraceInput = {
  investigationId: string;
  runId: string;
  sequence: number;
  tool: string;
  input: unknown;
  output: unknown;
  evidenceIds: string[];
  graphPaths: unknown[];
  modelRevision: string;
  promptRevision: string;
  truncated: boolean;
  idempotencyKey: string;
};

export async function recordToolCallTrace(request: Request, input: ToolCallTraceInput) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || !validInvestigationId(input.investigationId)) {
    return { ok: false as const, status: 400 as const, error: "Tool call trace is invalid or too large." };
  }
  const payload = {
    runId: input.runId, sequence: input.sequence, tool: input.tool,
    input: input.input, output: input.output, evidenceIds: input.evidenceIds,
    graphPaths: input.graphPaths, modelRevision: input.modelRevision,
    promptRevision: input.promptRevision, truncated: input.truncated,
  };
  if (!UUID_PATTERN.test(input.runId) || !Number.isInteger(input.sequence) || input.sequence < 1 || input.sequence > 1_000_000
    || !TOOL_NAMES.has(input.tool) || !Array.isArray(input.evidenceIds) || input.evidenceIds.length > 100
    || input.evidenceIds.some((id) => !boundedText(id, 300)) || !Array.isArray(input.graphPaths)
    || input.graphPaths.length > 20 || !boundedText(input.modelRevision, 160)
    || !boundedText(input.promptRevision, 160) || typeof input.truncated !== "boolean"
    || !boundedText(input.idempotencyKey, 160) || !sizedJson(payload, 40_000)) {
    return { ok: false as const, status: 400 as const, error: "Tool call trace is invalid or too large." };
  }
  return appendInvestigationEvent(request, input.investigationId, {
    type: "tool_call",
    idempotencyKey: input.idempotencyKey,
    payload,
  });
}

export type FinishRunInput = {
  investigationId: string;
  runId: string;
  status: "completed" | "failed";
  summary: string;
  truncated: boolean;
  idempotencyKey: string;
};

export async function finishRunTrace(request: Request, input: FinishRunInput) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || !validInvestigationId(input.investigationId) || !UUID_PATTERN.test(input.runId) || (input.status !== "completed" && input.status !== "failed")
    || !boundedText(input.summary, 2000) || typeof input.truncated !== "boolean"
    || !boundedText(input.idempotencyKey, 160)) {
    return { ok: false as const, status: 400 as const, error: "Run completion trace is invalid." };
  }
  return appendInvestigationEvent(request, input.investigationId, {
    type: input.status === "completed" ? "run_completed" : "run_failed",
    idempotencyKey: input.idempotencyKey,
    payload: { runId: input.runId, summary: input.summary.trim(), truncated: input.truncated },
  });
}

import { appendInvestigationEvent, listInvestigationEvents, listInvestigationEventsByIds } from "@/lib/investigations";
import { acknowledgeTaskHandoff, claimTask, completeTask, createTask, listTasks, requestTaskHandoff } from "@/lib/tasks";
import { createActionProposal } from "@/lib/action-proposals";
import { listInvestigationFacts, proposeInvestigationFactCandidate } from "@/lib/facts";
import { listInvestigationAttempts, recordInvestigationAttempt } from "@/lib/attempts";
import { finishRunTrace, recordToolCallTrace, startRunTrace } from "@/lib/run-traces";

export type RecallInput = { investigationId: string };
export type RememberInput = {
  investigationId: string;
  kind: "fact" | "constraint" | "attempt" | "finding" | "decision" | "outcome";
  idempotencyKey: string;
  memory: Record<string, unknown>;
};
export type CreateTaskInput = { investigationId: string; title: string; details?: Record<string, unknown>; idempotencyKey: string };
export type ClaimTaskInput = { investigationId: string; taskId: string; leaseSeconds?: number };
export type HandoffTaskInput = { investigationId: string; taskId: string; recipientUserId: string; idempotencyKey: string };
export type TaskInput = { investigationId: string; taskId: string };
export type ExplainInput = { investigationId: string; claim: string; evidenceEventIds: string[] };
export type ProposeActionInput = {
  investigationId: string;
  type: "github_patch" | "deployment_rollback";
  target: Record<string, unknown>;
  inputs: Record<string, unknown>;
  evidence: Array<Record<string, unknown>>;
  rationale: string;
  risk: string;
  idempotencyKey: string;
};
export type RememberFactInput = {
  investigationId: string;
  factKey: string;
  value: unknown;
  provenance: Array<{ sourceId: string; version: string }>;
  expectedVersion: number;
  idempotencyKey: string;
};
export type RecordAttemptInput = {
  investigationId: string;
  attemptKey: string;
  conditionSnapshot: Record<string, unknown>;
  outcome: "failed" | "completed";
  summary: string;
  retryExplanation?: string;
  changedConditions: Array<{ description: string; sourceId: string; version: string }>;
  idempotencyKey: string;
};

export function startAgentRun(request: Request, input: Parameters<typeof startRunTrace>[1]) {
  return startRunTrace(request, input);
}

export function traceAgentToolCall(request: Request, input: Parameters<typeof recordToolCallTrace>[1]) {
  return recordToolCallTrace(request, input);
}

export function finishAgentRun(request: Request, input: Parameters<typeof finishRunTrace>[1]) {
  return finishRunTrace(request, input);
}

export function recallMemory(request: Request, input: RecallInput) {
  return listInvestigationEvents(request, input.investigationId);
}

export function recallInvestigationFacts(request: Request, input: RecallInput) {
  return listInvestigationFacts(request, input.investigationId);
}

export function rememberCurrentFact(request: Request, input: RememberFactInput) {
  const { investigationId, ...fact } = input;
  return proposeInvestigationFactCandidate(request, investigationId, fact);
}

export function recallInvestigationAttempts(request: Request, input: RecallInput) {
  return listInvestigationAttempts(request, input.investigationId);
}

export function recordAttempt(request: Request, input: RecordAttemptInput) {
  const { investigationId, ...attempt } = input;
  return recordInvestigationAttempt(request, investigationId, attempt);
}

export async function explainInvestigation(request: Request, input: ExplainInput) {
  if (!input || typeof input.claim !== "string" || !Array.isArray(input.evidenceEventIds)
    || input.evidenceEventIds.some((id) => typeof id !== "string")) {
    return { ok: false as const, status: 400 as const, error: "Claim or evidence event IDs are invalid." };
  }
  const claim = input.claim.trim();
  if (!claim || claim.length > 1000
    || input.evidenceEventIds.length > 20
    || input.evidenceEventIds.some((id) => !/^[1-9]\d{0,18}$/.test(id))) {
    return { ok: false as const, status: 400 as const, error: "Claim or evidence event IDs are invalid." };
  }
  const events = await listInvestigationEventsByIds(request, input.investigationId, input.evidenceEventIds);
  if (!events.ok) return events;
  const evidence = events.data;
  return {
    ok: true as const,
    value: {
      claim,
      evidence,
      abstained: evidence.length === 0,
      reason: evidence.length === 0 ? "No accessible evidence was linked to this claim." : null,
      missingEvidenceEventIds: input.evidenceEventIds.filter((id) => !evidence.some((event) => String(event.id) === id)),
    },
  };
}

export function rememberMemory(request: Request, input: RememberInput) {
  return appendInvestigationEvent(request, input.investigationId, {
    type: input.kind,
    idempotencyKey: input.idempotencyKey,
    payload: input.memory,
  });
}

export function createInvestigationTask(request: Request, input: CreateTaskInput) {
  return createTask(request, input.investigationId, input);
}

export function recallInvestigationTasks(request: Request, input: RecallInput) {
  return listTasks(request, input.investigationId);
}

export function claimInvestigationTask(request: Request, input: ClaimTaskInput) {
  return claimTask(request, input.investigationId, input.taskId, input.leaseSeconds);
}

export function handoffInvestigationTask(request: Request, input: HandoffTaskInput) {
  return requestTaskHandoff(request, input.investigationId, input.taskId, input);
}

export function acknowledgeInvestigationTaskHandoff(request: Request, input: TaskInput) {
  return acknowledgeTaskHandoff(request, input.investigationId, input.taskId);
}

export function completeInvestigationTask(request: Request, input: TaskInput) {
  return completeTask(request, input.investigationId, input.taskId);
}

export function proposeInvestigationAction(request: Request, input: ProposeActionInput) {
  const { investigationId, ...proposal } = input;
  return createActionProposal(request, investigationId, proposal);
}

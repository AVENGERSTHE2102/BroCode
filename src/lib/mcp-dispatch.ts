import { acknowledgeInvestigationTaskHandoff, claimInvestigationTask, completeInvestigationTask, createInvestigationTask, explainInvestigation, handoffInvestigationTask, proposeInvestigationAction, recallInvestigationAttempts, recallInvestigationFacts, recallInvestigationTasks, rememberCurrentFact } from "@/lib/agent-tools";
import { resolveGraphEntity, traceGraphEntity } from "@/lib/graph-tools";
import { findExperts, graphOverview, impactAnalysis, searchEntities, shortestPath } from "@/lib/graph-agent-tools";

export const mcpToolKinds: Record<string, "resolve" | "trace" | "recall" | "remember" | "task" | "propose_action" | "explain"> = {
  resolve_entity: "resolve", trace_entity: "trace", recall_facts: "recall", recall_attempts: "recall", remember_fact: "remember",
  create_task: "task", list_tasks: "task", claim_task: "task", handoff_task: "task", acknowledge_task_handoff: "task", complete_task: "task",
  propose_action: "propose_action", explain_evidence: "explain",
  search_entities: "resolve", graph_overview: "resolve", find_experts: "trace", impact_analysis: "trace", shortest_path: "trace",
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export async function invokeMcpTool(request: Request, name: string, input: unknown) {
  if (!isRecord(input)) return { ok: false as const, status: 400 as const, error: "Tool arguments must be an object." };
  switch (name) {
    case "resolve_entity": return resolveGraphEntity(request, input as never);
    case "trace_entity": return traceGraphEntity(request, input as never);
    case "search_entities": return searchEntities(request, input);
    case "graph_overview": return graphOverview(request, input);
    case "find_experts": return findExperts(request, input);
    case "impact_analysis": return impactAnalysis(request, input);
    case "shortest_path": return shortestPath(request, input);
    case "recall_facts": return typeof input.investigationId === "string" ? recallInvestigationFacts(request, { investigationId: input.investigationId }) : { ok: false as const, status: 400 as const, error: "Investigation ID is required." };
    case "recall_attempts": return typeof input.investigationId === "string" ? recallInvestigationAttempts(request, { investigationId: input.investigationId }) : { ok: false as const, status: 400 as const, error: "Investigation ID is required." };
    case "remember_fact": return rememberCurrentFact(request, input as never);
    case "create_task": return createInvestigationTask(request, input as never);
    case "list_tasks": return typeof input.investigationId === "string" ? recallInvestigationTasks(request, { investigationId: input.investigationId }) : { ok: false as const, status: 400 as const, error: "Investigation ID is required." };
    case "claim_task": return claimInvestigationTask(request, input as never);
    case "handoff_task": return handoffInvestigationTask(request, input as never);
    case "acknowledge_task_handoff": return acknowledgeInvestigationTaskHandoff(request, input as never);
    case "complete_task": return completeInvestigationTask(request, input as never);
    case "propose_action": return proposeInvestigationAction(request, input as never);
    case "explain_evidence": return explainInvestigation(request, input as never);
    default: return null;
  }
}

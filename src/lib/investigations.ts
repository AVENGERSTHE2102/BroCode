import { workspaceSupabase } from "@/lib/workspace-supabase";
import { isWorkflowDomain } from "@/lib/workflow-domains";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPES = new Set(["question", "evidence", "tool_call", "finding", "decision", "handoff", "outcome", "fact", "constraint", "attempt", "run_started", "run_completed", "run_failed"]);

async function scope(request: Request) {
  return workspaceSupabase(request);
}

export async function listInvestigations(request: Request) {
  const current = await scope(request);
  if (!current.ok) return current;
  const { data, error } = await current.supabase.from("investigations")
    .select("id, title, workflow_domain, status, created_at, updated_at")
    .eq("workspace_id", current.workspace.id)
    .order("updated_at", { ascending: false }).limit(50);
  if (error) return { ok: false as const, status: 503 as const, error: "Investigations could not be loaded." };
  return { ok: true as const, data };
}

export async function getInvestigation(request: Request, investigationId: string) {
  const current = await scope(request);
  if (!current.ok) return current;
  if (!UUID_PATTERN.test(investigationId)) return { ok: false as const, status: 400 as const, error: "Investigation ID is invalid." };
  const { data, error } = await current.supabase.from("investigations")
    .select("id, title, workflow_domain, status, created_at, updated_at")
    .eq("workspace_id", current.workspace.id).eq("id", investigationId).maybeSingle();
  if (error) return { ok: false as const, status: 503 as const, error: "Investigation could not be loaded." };
  if (!data) return { ok: false as const, status: 404 as const, error: "Investigation not found." };
  return { ok: true as const, data };
}

export async function createInvestigation(request: Request, body: unknown) {
  const current = await scope(request);
  if (!current.ok) return current;
  const value = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const workflowDomain = value.workflowDomain === undefined ? "general" : value.workflowDomain;
  if (title.length < 1 || title.length > 200) return { ok: false as const, status: 400 as const, error: "Title must be 1–200 characters." };
  if (!isWorkflowDomain(workflowDomain)) return { ok: false as const, status: 400 as const, error: "Workflow domain is invalid." };
  const { data, error } = await current.supabase.from("investigations")
    .insert({ workspace_id: current.workspace.id, created_by: current.workspace.userId, title, workflow_domain: workflowDomain })
    .select("id, title, workflow_domain, status, created_at, updated_at").single();
  if (error) return { ok: false as const, status: 503 as const, error: "Investigation could not be created." };
  return { ok: true as const, data };
}

export async function listInvestigationEvents(request: Request, investigationId: string) {
  const current = await scope(request);
  if (!current.ok) return current;
  if (!UUID_PATTERN.test(investigationId)) return { ok: false as const, status: 400 as const, error: "Investigation ID is invalid." };
  const { data, error } = await current.supabase.from("investigation_events")
    .select("id, actor_id, event_type, idempotency_key, payload, created_at")
    .eq("workspace_id", current.workspace.id).eq("investigation_id", investigationId)
    .order("id", { ascending: true }).limit(100);
  if (error) return { ok: false as const, status: 503 as const, error: "Investigation events could not be loaded." };
  return { ok: true as const, data };
}

export async function listInvestigationEventsByIds(request: Request, investigationId: string, ids: string[]) {
  const current = await scope(request);
  if (!current.ok) return current;
  if (!UUID_PATTERN.test(investigationId) || ids.length > 20 || ids.some((id) => !/^[1-9]\d{0,18}$/.test(id))) {
    return { ok: false as const, status: 400 as const, error: "Investigation or evidence event IDs are invalid." };
  }
  if (ids.length === 0) return { ok: true as const, data: [] };
  const { data, error } = await current.supabase.from("investigation_events")
    .select("id, actor_id, event_type, idempotency_key, payload, created_at")
    .eq("workspace_id", current.workspace.id).eq("investigation_id", investigationId)
    .in("id", ids).limit(20);
  if (error) return { ok: false as const, status: 503 as const, error: "Evidence events could not be loaded." };
  return { ok: true as const, data };
}

export async function appendInvestigationEvent(request: Request, investigationId: string, body: unknown) {
  const current = await scope(request);
  if (!current.ok) return current;
  if (!UUID_PATTERN.test(investigationId)) return { ok: false as const, status: 400 as const, error: "Investigation ID is invalid." };
  if (typeof body !== "object" || body === null) return { ok: false as const, status: 400 as const, error: "Event body is invalid." };
  const event = body as Record<string, unknown>;
  const { type, idempotencyKey, payload } = event;
  if (typeof type !== "string" || !EVENT_TYPES.has(type) || typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 160) {
    return { ok: false as const, status: 400 as const, error: "Event type or idempotency key is invalid." };
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload) || new TextEncoder().encode(JSON.stringify(payload)).byteLength > 48_000) {
    return { ok: false as const, status: 400 as const, error: "Event payload must be an object under 48 KB." };
  }
  const { data, error } = await current.supabase.from("investigation_events").upsert({
    workspace_id: current.workspace.id,
    investigation_id: investigationId,
    actor_id: current.workspace.userId,
    event_type: type,
    idempotency_key: idempotencyKey,
    payload,
  }, { onConflict: "workspace_id,investigation_id,idempotency_key", ignoreDuplicates: true })
    .select("id, event_type, idempotency_key, payload, created_at").maybeSingle();
  if (error) return { ok: false as const, status: 503 as const, error: "Event could not be recorded." };
  return { ok: true as const, data, duplicate: !data };
}

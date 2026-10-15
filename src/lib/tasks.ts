import { workspaceSupabase } from "@/lib/workspace-supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function findTask(request: Request, investigationId: string, taskId: string) {
  const current = await workspaceSupabase(request);
  if (!current.ok) return current;
  if (!UUID_PATTERN.test(investigationId) || !UUID_PATTERN.test(taskId)) {
    return { ok: false as const, status: 400 as const, error: "Investigation or task ID is invalid." };
  }
  const { data, error } = await current.supabase.from("investigation_tasks").select("id")
    .eq("workspace_id", current.workspace.id).eq("investigation_id", investigationId).eq("id", taskId).maybeSingle();
  if (error) return { ok: false as const, status: 503 as const, error: "Task could not be checked." };
  if (!data) return { ok: false as const, status: 404 as const, error: "Task not found." };
  return current;
}

function rpcFailure(error: { code?: string }) {
  if (error.code === "22023") return { ok: false as const, status: 400 as const, error: "Task input is invalid." };
  if (["23505", "42501", "P0002"].includes(error.code ?? "")) return { ok: false as const, status: 409 as const, error: "Task state or authorization no longer permits this action." };
  return { ok: false as const, status: 503 as const, error: "Task storage is unavailable." };
}

export async function listTasks(request: Request, investigationId: string) {
  const current = await workspaceSupabase(request);
  if (!current.ok) return current;
  if (!UUID_PATTERN.test(investigationId)) return { ok: false as const, status: 400 as const, error: "Investigation ID is invalid." };
  const { data, error } = await current.supabase.from("investigation_tasks")
    .select("id, title, details, status, owner_id, lease_expires_at, version, created_at, updated_at")
    .eq("workspace_id", current.workspace.id).eq("investigation_id", investigationId)
    .order("created_at", { ascending: false }).limit(100);
  if (error) return { ok: false as const, status: 503 as const, error: "Tasks could not be loaded." };
  const tasks = data ?? [];
  if (!tasks.length) return { ok: true as const, data: tasks };
  const { data: handoffs, error: handoffError } = await current.supabase.from("investigation_task_handoffs")
    .select("id, task_id, from_user_id, requested_at")
    .eq("workspace_id", current.workspace.id).eq("to_user_id", current.workspace.userId).eq("status", "pending")
    .in("task_id", tasks.map((task) => task.id)).order("requested_at", { ascending: false });
  if (handoffError) return { ok: false as const, status: 503 as const, error: "Task handoffs could not be loaded." };
  const pendingHandoffs = new Map<string, (typeof handoffs)[number]>();
  for (const handoff of handoffs ?? []) {
    if (!pendingHandoffs.has(handoff.task_id)) pendingHandoffs.set(handoff.task_id, handoff);
  }
  return { ok: true as const, data: tasks.map((task) => ({
    ...task,
    pending_handoff: pendingHandoffs.get(task.id) ?? null,
  })) };
}

export async function createTask(request: Request, investigationId: string, body: unknown) {
  const current = await workspaceSupabase(request);
  if (!current.ok) return current;
  if (!UUID_PATTERN.test(investigationId) || typeof body !== "object" || body === null) {
    return { ok: false as const, status: 400 as const, error: "Task input is invalid." };
  }
  const input = body as Record<string, unknown>;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const details = input.details === undefined ? {} : input.details;
  const key = input.idempotencyKey;
  if (!title || title.length > 200 || typeof key !== "string" || key.length < 1 || key.length > 160
    || typeof details !== "object" || details === null || Array.isArray(details)
    || new TextEncoder().encode(JSON.stringify(details)).byteLength > 16_000) {
    return { ok: false as const, status: 400 as const, error: "Title, details, or idempotency key is invalid." };
  }
  const { data, error } = await current.supabase.rpc("create_investigation_task", {
    p_investigation_id: investigationId, p_title: title, p_details: details, p_idempotency_key: key,
  });
  if (error) return rpcFailure(error);
  return { ok: true as const, data: Array.isArray(data) ? data[0] ?? null : data };
}

export async function claimTask(request: Request, investigationId: string, taskId: string, leaseSeconds = 300) {
  const current = await findTask(request, investigationId, taskId);
  if (!current.ok) return current;
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 1800) {
    return { ok: false as const, status: 400 as const, error: "Lease must be 30–1800 seconds." };
  }
  const { data, error } = await current.supabase.rpc("claim_investigation_task", { p_task_id: taskId, p_lease_seconds: leaseSeconds });
  if (error) return rpcFailure(error);
  const task = Array.isArray(data) ? data[0] : null;
  return task ? { ok: true as const, data: task } : { ok: false as const, status: 409 as const, error: "Task is already claimed or closed." };
}

export async function requestTaskHandoff(request: Request, investigationId: string, taskId: string, body: unknown) {
  const current = await findTask(request, investigationId, taskId);
  if (!current.ok) return current;
  if (typeof body !== "object" || body === null) return { ok: false as const, status: 400 as const, error: "Handoff input is invalid." };
  const { recipientUserId, idempotencyKey } = body as Record<string, unknown>;
  if (typeof recipientUserId !== "string" || !UUID_PATTERN.test(recipientUserId)
    || typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 160) {
    return { ok: false as const, status: 400 as const, error: "Recipient or idempotency key is invalid." };
  }
  const { data, error } = await current.supabase.rpc("request_investigation_task_handoff", {
    p_task_id: taskId, p_to_user_id: recipientUserId, p_idempotency_key: idempotencyKey,
  });
  if (error) return rpcFailure(error);
  return { ok: true as const, data: Array.isArray(data) ? data[0] ?? null : data };
}

export async function acknowledgeTaskHandoff(request: Request, investigationId: string, taskId: string) {
  const current = await findTask(request, investigationId, taskId);
  if (!current.ok) return current;
  const { data, error } = await current.supabase.rpc("acknowledge_investigation_task_handoff", { p_task_id: taskId, p_lease_seconds: 300 });
  if (error) return rpcFailure(error);
  const task = Array.isArray(data) ? data[0] : null;
  return task ? { ok: true as const, data: task } : { ok: false as const, status: 409 as const, error: "No active handoff is available." };
}

export async function completeTask(request: Request, investigationId: string, taskId: string) {
  const current = await findTask(request, investigationId, taskId);
  if (!current.ok) return current;
  const { data, error } = await current.supabase.rpc("complete_investigation_task", { p_task_id: taskId });
  if (error) return rpcFailure(error);
  const task = Array.isArray(data) ? data[0] : null;
  return task ? { ok: true as const, data: task } : { ok: false as const, status: 409 as const, error: "Task cannot be completed in its current state." };
}

import { workspaceSupabase } from "@/lib/workspace-supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ValidAttemptInput = {
  attemptKey: string;
  conditionSnapshot: Record<string, unknown>;
  outcome: "failed" | "completed";
  summary: string;
  retryExplanation?: string;
  changedConditions: Array<{ description: string; sourceId: string; version: string }>;
  idempotencyKey: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateAttemptInput(body: unknown) {
  if (!record(body) || typeof body.attemptKey !== "string" || !body.attemptKey.trim() || body.attemptKey.length > 200
    || !record(body.conditionSnapshot) || !["failed", "completed"].includes(String(body.outcome))
    || typeof body.summary !== "string" || !body.summary.trim() || body.summary.length > 4000
    || (body.retryExplanation !== undefined && (typeof body.retryExplanation !== "string"
      || !body.retryExplanation.trim() || body.retryExplanation.length > 2000))
    || !Array.isArray(body.changedConditions) || body.changedConditions.length > 20
    || typeof body.idempotencyKey !== "string" || !body.idempotencyKey.trim() || body.idempotencyKey.length > 160) {
    return { ok: false as const, status: 400 as const, error: "Attempt input is invalid." };
  }
  if (body.changedConditions.some((item) => !record(item) || typeof item.description !== "string"
    || !item.description.trim() || item.description.length > 500 || typeof item.sourceId !== "string"
    || !item.sourceId.trim() || item.sourceId.length > 300 || typeof item.version !== "string"
    || !item.version.trim() || item.version.length > 200)) {
    return { ok: false as const, status: 400 as const, error: "Changed conditions require explanations and source versions." };
  }
  if ((typeof body.retryExplanation === "string") !== (body.changedConditions.length > 0)) {
    return { ok: false as const, status: 400 as const, error: "Retry explanations and changed-condition evidence must be provided together." };
  }
  const conditionSize = new TextEncoder().encode(JSON.stringify(body.conditionSnapshot)).byteLength;
  const changeSize = new TextEncoder().encode(JSON.stringify(body.changedConditions)).byteLength;
  if (conditionSize > 12_000 || changeSize > 8_000) {
    return { ok: false as const, status: 413 as const, error: "Attempt conditions exceed the size limit." };
  }
  return {
    ok: true as const,
    value: {
      attemptKey: body.attemptKey.trim(),
      conditionSnapshot: body.conditionSnapshot,
      outcome: body.outcome as ValidAttemptInput["outcome"],
      summary: body.summary.trim(),
      ...(typeof body.retryExplanation === "string" ? { retryExplanation: body.retryExplanation.trim() } : {}),
      changedConditions: (body.changedConditions as ValidAttemptInput["changedConditions"]).map((item) => ({
        description: item.description.trim(), sourceId: item.sourceId.trim(), version: item.version.trim(),
      })),
      idempotencyKey: body.idempotencyKey.trim(),
    },
  };
}

export async function listInvestigationAttempts(request: Request, investigationId: string) {
  const current = await workspaceSupabase(request);
  if (!current.ok) return current;
  if (!UUID_PATTERN.test(investigationId)) return { ok: false as const, status: 400 as const, error: "Investigation ID is invalid." };
  const { data, error } = await current.supabase.from("investigation_attempts")
    .select("id, attempt_key, attempt_number, previous_attempt_id, condition_snapshot, outcome, summary, retry_explanation, changed_conditions, created_by, created_at")
    .eq("workspace_id", current.workspace.id).eq("investigation_id", investigationId)
    .order("created_at", { ascending: false }).limit(100);
  if (error) return { ok: false as const, status: 503 as const, error: "Investigation attempts could not be loaded." };
  return { ok: true as const, data };
}

export async function recordInvestigationAttempt(request: Request, investigationId: string, body: unknown) {
  const parsed = validateAttemptInput(body);
  if (!parsed.ok) return parsed;
  if (!UUID_PATTERN.test(investigationId)) return { ok: false as const, status: 400 as const, error: "Investigation ID is invalid." };
  const current = await workspaceSupabase(request);
  if (!current.ok) return current;
  const input = parsed.value;
  const { data, error } = await current.supabase.rpc("record_investigation_attempt", {
    p_investigation_id: investigationId,
    p_attempt_key: input.attemptKey,
    p_condition_snapshot: input.conditionSnapshot,
    p_outcome: input.outcome,
    p_summary: input.summary,
    p_retry_explanation: input.retryExplanation ?? null,
    p_changed_conditions: input.changedConditions,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error?.code === "22023") return { ok: false as const, status: 400 as const, error: "Attempt input or retry evidence is invalid." };
  if (error?.code === "23514") return { ok: false as const, status: 409 as const, error: "Changed-condition evidence does not match an available workspace source version." };
  if (["40001", "23505"].includes(error?.code ?? "")) return { ok: false as const, status: 409 as const, error: "A repeated failure needs changed conditions and supporting evidence, or the idempotency key conflicts." };
  if (error?.code === "P0002") return { ok: false as const, status: 404 as const, error: "Investigation not found." };
  if (error?.code === "42501") return { ok: false as const, status: 403 as const, error: "Workspace access is no longer available." };
  if (error) return { ok: false as const, status: 503 as const, error: "Attempt storage is unavailable." };
  return { ok: true as const, data };
}

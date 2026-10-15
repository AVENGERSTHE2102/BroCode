import { workspaceSupabase } from "@/lib/workspace-supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type FactInput = {
  factKey: string;
  value: unknown;
  provenance: Array<{ sourceId: string; version: string }>;
  expectedVersion: number;
  idempotencyKey: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateFactInput(body: unknown) {
  if (!record(body) || typeof body.factKey !== "string" || body.factKey.trim().length < 1 || body.factKey.length > 200
    || !Array.isArray(body.provenance) || body.provenance.length < 1 || body.provenance.length > 20
    || !Number.isInteger(body.expectedVersion) || (body.expectedVersion as number) < 0
    || typeof body.idempotencyKey !== "string" || body.idempotencyKey.length < 1 || body.idempotencyKey.length > 160) {
    return { ok: false as const, status: 400 as const, error: "Fact input is invalid." };
  }
  if (body.provenance.some((item) => !record(item) || typeof item.sourceId !== "string"
    || !item.sourceId.trim() || item.sourceId.length > 300 || typeof item.version !== "string"
    || !item.version.trim() || item.version.length > 200)) {
    return { ok: false as const, status: 400 as const, error: "Fact provenance requires a source ID and version." };
  }
  const serialized = JSON.stringify(body.value);
  const provenance = body.provenance as FactInput["provenance"];
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > 16_000
    || new TextEncoder().encode(JSON.stringify(provenance)).byteLength > 8_000) {
    return { ok: false as const, status: 413 as const, error: "Fact value or provenance is too large." };
  }
  return {
    ok: true as const,
    value: {
      factKey: body.factKey.trim(),
      value: body.value,
      provenance,
      expectedVersion: body.expectedVersion as number,
      idempotencyKey: body.idempotencyKey,
    },
  };
}

export async function listInvestigationFacts(request: Request, investigationId: string) {
  const current = await workspaceSupabase(request);
  if (!current.ok) return current;
  if (!UUID_PATTERN.test(investigationId)) return { ok: false as const, status: 400 as const, error: "Investigation ID is invalid." };
  const [facts, versions] = await Promise.all([
    current.supabase.from("investigation_facts")
      .select("id, fact_key, value, provenance, version, updated_by, created_at, updated_at")
      .eq("workspace_id", current.workspace.id).eq("investigation_id", investigationId)
      .order("fact_key", { ascending: true }).limit(101),
    current.supabase.from("investigation_fact_versions")
      .select("id, fact_id, fact_key, version, value, provenance, changed_by, idempotency_key, created_at")
      .eq("workspace_id", current.workspace.id).eq("investigation_id", investigationId)
      .order("created_at", { ascending: false }).limit(101),
  ]);
  if (facts.error || versions.error) return { ok: false as const, status: 503 as const, error: "Investigation facts could not be loaded." };
  return {
    ok: true as const,
    data: {
      facts: facts.data.slice(0, 100),
      versions: versions.data.slice(0, 100),
      truncated: facts.data.length > 100 || versions.data.length > 100,
    },
  };
}

export async function proposeInvestigationFactCandidate(request: Request, investigationId: string, body: unknown) {
  const parsed = validateFactInput(body);
  if (!parsed.ok) return parsed;
  if (!UUID_PATTERN.test(investigationId)) return { ok: false as const, status: 400 as const, error: "Investigation ID is invalid." };
  const current = await workspaceSupabase(request);
  if (!current.ok) return current;
  const { factKey, value, provenance, expectedVersion, idempotencyKey } = parsed.value;
  const { data, error } = await current.supabase.rpc("propose_investigation_fact_candidate", {
    p_investigation_id: investigationId, p_fact_key: factKey, p_value: value,
    p_provenance: provenance, p_expected_version: expectedVersion, p_idempotency_key: idempotencyKey,
  });
  if (error?.code === "22023") return { ok: false as const, status: 400 as const, error: "Fact candidate input is invalid." };
  if (error?.code === "23505") return { ok: false as const, status: 409 as const, error: "Candidate idempotency key conflicts with different content." };
  if (error?.code === "P0002") return { ok: false as const, status: 404 as const, error: "Investigation not found." };
  if (error?.code === "42501") return { ok: false as const, status: 403 as const, error: "Workspace access is no longer available." };
  if (error) return { ok: false as const, status: 503 as const, error: "Fact candidate could not be stored." };
  return { ok: true as const, data };
}

export async function listFactCandidates(request: Request, investigationId: string) {
  const current = await workspaceSupabase(request);
  if (!current.ok) return current;
  if (!UUID_PATTERN.test(investigationId)) return { ok: false as const, status: 400 as const, error: "Investigation ID is invalid." };
  if (current.workspace.role !== "owner" && current.workspace.role !== "admin") {
    return { ok: false as const, status: 403 as const, error: "Only workspace owners and admins can review fact candidates." };
  }
  const { data, error } = await current.supabase.from("investigation_fact_candidates")
    .select("id, fact_key, value, provenance, expected_version, submitted_by, created_at")
    .eq("workspace_id", current.workspace.id).eq("investigation_id", investigationId).eq("status", "pending")
    .order("created_at", { ascending: true }).limit(50);
  if (error) return { ok: false as const, status: 503 as const, error: "Fact candidates could not be loaded." };
  return { ok: true as const, data };
}

export async function reviewFactCandidate(request: Request, investigationId: string, candidateId: string, body: unknown) {
  if (!UUID_PATTERN.test(investigationId) || !UUID_PATTERN.test(candidateId) || !record(body) || !["approve", "reject"].includes(String(body.decision))
    || (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 1000))) {
    return { ok: false as const, status: 400 as const, error: "Fact candidate review input is invalid." };
  }
  const current = await workspaceSupabase(request);
  if (!current.ok) return current;
  if (current.workspace.role !== "owner" && current.workspace.role !== "admin") {
    return { ok: false as const, status: 403 as const, error: "Only workspace owners and admins can review fact candidates." };
  }
  const { data, error } = await current.supabase.rpc("review_investigation_fact_candidate", {
    p_investigation_id: investigationId, p_candidate_id: candidateId, p_decision: body.decision, p_review_note: body.note ?? null,
  });
  if (error?.code === "22023") return { ok: false as const, status: 400 as const, error: "Fact candidate review input is invalid." };
  if (error?.code === "23514") return { ok: false as const, status: 409 as const, error: "Candidate provenance does not match an available workspace source version." };
  if (error?.code === "40001") return { ok: false as const, status: 409 as const, error: "Candidate was already reviewed or its expected fact version is stale." };
  if (error?.code === "P0002" || error?.code === "42501") return { ok: false as const, status: 404 as const, error: "Fact candidate is unavailable." };
  if (error) return { ok: false as const, status: 503 as const, error: "Fact candidate review could not be stored." };
  return { ok: true as const, data };
}

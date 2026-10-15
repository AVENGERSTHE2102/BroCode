import { createHash, randomUUID } from "node:crypto";
import { createGitHubProposalPullRequest } from "@/lib/github-app";
import { validatePriorAttemptReview } from "@/lib/attempt-review";
import { workspaceSupabase } from "@/lib/workspace-supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION_TYPES = new Set(["github_patch", "deployment_rollback"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.length <= max;
}

export function validateActionProposal(body: unknown) {
  if (!record(body)) return { ok: false as const, status: 400 as const, error: "Action proposal input is invalid." };
  const { type, target, inputs, evidence, rationale, risk, idempotencyKey } = body;
  if (typeof type !== "string" || !ACTION_TYPES.has(type) || !record(target) || !record(inputs)
    || !Array.isArray(evidence) || evidence.length < 1 || evidence.length > 30
    || !boundedText(rationale, 1, 4000) || !boundedText(risk, 1, 2000)
    || !boundedText(idempotencyKey, 1, 160)) {
    return { ok: false as const, status: 400 as const, error: "Action proposal fields are invalid." };
  }
  if (type === "github_patch" && (!boundedText(target.repository, 3, 201)
    || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(String(target.repository))
    || !boundedText(target.ref, 1, 255) || !/^[A-Za-z0-9._/-]+$/.test(String(target.ref))
    || !/^[a-f0-9]{40}$/i.test(String(target.baseSha)) || !boundedText(inputs.title, 1, 200)
    || !boundedText(inputs.patch, 1, 48_000))) {
    return { ok: false as const, status: 400 as const, error: "GitHub proposals require a repository, base branch and commit, title, and exact patch." };
  }
  if (type === "deployment_rollback" && ["provider", "serviceId", "environment", "currentRevision", "targetRevision"]
    .some((key) => !boundedText(target[key], 1, 300))) {
    return { ok: false as const, status: 400 as const, error: "Rollback proposals require exact provider, service, environment, and revisions." };
  }
  if (type === "deployment_rollback" && target.currentRevision === target.targetRevision) {
    return { ok: false as const, status: 400 as const, error: "Rollback current and target revisions must differ." };
  }
  if (evidence.some((item) => !record(item) || !boundedText(item.sourceId, 1, 300) || !boundedText(item.version, 1, 200))) {
    return { ok: false as const, status: 400 as const, error: "Each evidence item requires a source ID and version." };
  }
  const normalizedRationale = rationale.trim();
  const normalizedRisk = risk.trim();
  const serialized = JSON.stringify({ type, target, inputs, evidence, rationale: normalizedRationale, risk: normalizedRisk });
  if (new TextEncoder().encode(serialized).byteLength > 60_000) {
    return { ok: false as const, status: 413 as const, error: "Action proposal exceeds 60 KB." };
  }
  return {
    ok: true as const,
    value: {
      type,
      target,
      inputs,
      evidence,
      rationale: normalizedRationale,
      risk: normalizedRisk,
      idempotencyKey,
      serialized,
    },
  };
}

export async function listActionProposals(request: Request, investigationId: string) {
  const current = await workspaceSupabase(request);
  if (!current.ok) return current;
  if (!UUID_PATTERN.test(investigationId)) return { ok: false as const, status: 400 as const, error: "Investigation ID is invalid." };
  const { data, error } = await current.supabase.from("action_proposals")
    .select("id, proposal_type, target, inputs, evidence, rationale, risk, content_hash, status, created_by, created_at, execution_attempt, execution_result, execution_error")
    .eq("workspace_id", current.workspace.id).eq("investigation_id", investigationId)
    .order("created_at", { ascending: false }).limit(50);
  if (error) return { ok: false as const, status: 503 as const, error: "Action proposals could not be loaded." };
  return { ok: true as const, data };
}

export async function executeActionProposal(request: Request, investigationId: string, proposalId: string, body: unknown) {
  const current = await workspaceSupabase(request);
  if (!current.ok) return current;
  if (!UUID_PATTERN.test(investigationId) || !UUID_PATTERN.test(proposalId) || !record(body)
    || typeof body.expectedContentHash !== "string" || !/^[a-f0-9]{64}$/.test(body.expectedContentHash)) {
    return { ok: false as const, status: 400 as const, error: "Proposal execution input is invalid." };
  }
  if (current.workspace.role !== "owner" && current.workspace.role !== "admin") {
    return { ok: false as const, status: 403 as const, error: "Only workspace owners and admins can execute an approved proposal." };
  }
  const leaseId = randomUUID();
  const { data: claim, error: claimError } = await current.supabase.rpc("claim_action_proposal_execution", {
    p_investigation_id: investigationId, p_proposal_id: proposalId,
    p_expected_hash: body.expectedContentHash, p_lease_id: leaseId,
  });
  if (claimError) {
    if (["40001", "42501", "P0002", "22023"].includes(claimError.code ?? "")) {
      return { ok: false as const, status: claimError.code === "P0002" || claimError.code === "42501" ? 403 as const : 409 as const, error: "Proposal is unavailable, unapproved, or changed since review." };
    }
    return { ok: false as const, status: 503 as const, error: "Proposal execution could not be claimed." };
  }
  if (!record(claim)) return { ok: false as const, status: 503 as const, error: "Proposal execution claim is invalid." };
  if (claim.state === "succeeded") return { ok: true as const, data: claim.result, duplicate: true };
  if (claim.state === "executing") return { ok: false as const, status: 409 as const, error: "This proposal is already executing." };
  if (claim.state === "stale") return { ok: false as const, status: 409 as const, error: "Approval expired; create and review a fresh proposal." };
  if (claim.state !== "claimed" || claim.lease_id !== leaseId || !record(claim.proposal)) {
    return { ok: false as const, status: 409 as const, error: "Proposal is not approved for execution." };
  }
  const proposal = claim.proposal;
  try {
    if (proposal.proposal_type !== "github_patch" || !record(proposal.target) || !record(proposal.inputs)
      || !Array.isArray(proposal.evidence) || typeof proposal.rationale !== "string" || typeof proposal.risk !== "string"
      || proposal.content_hash !== body.expectedContentHash) throw new Error("Proposal details do not match the supported GitHub action.");
    const target = proposal.target;
    const inputs = proposal.inputs;
    const { data: source, error: sourceError } = await current.supabase.from("workspace_github_sources")
      .select("id, installation_id, repository_id, full_name, default_branch")
      .eq("workspace_id", current.workspace.id).eq("full_name", target.repository).maybeSingle();
    if (sourceError || !source || source.full_name.toLowerCase() !== String(target.repository).toLowerCase()
      || source.default_branch !== target.ref) throw new Error("The approved repository is not connected or its base branch changed.");
    const sourceIds = [...new Set(proposal.evidence.flatMap((item) => record(item) && typeof item.sourceId === "string" ? [item.sourceId] : []))];
    if (sourceIds.length !== proposal.evidence.length) throw new Error("Proposal evidence references are invalid.");
    const { data: evidenceRows, error: evidenceError } = await current.supabase.from("workspace_github_records")
      .select("record_id, provider_version").eq("workspace_id", current.workspace.id)
      .eq("github_source_id", source.id).in("record_id", sourceIds);
    if (evidenceError || !evidenceRows || evidenceRows.length !== sourceIds.length
      || proposal.evidence.some((item) => !record(item) || !evidenceRows.some((row) => row.record_id === item.sourceId && row.provider_version === item.version))) {
      throw new Error("Proposal evidence is no longer current for the connected repository.");
    }
    const result = await createGitHubProposalPullRequest({
      installationId: Number(source.installation_id), repositoryId: Number(source.repository_id), fullName: source.full_name,
      proposalId, proposalHash: proposal.content_hash, title: String(inputs.title), patch: String(inputs.patch),
      baseRef: String(target.ref), baseSha: String(target.baseSha), createdAt: String(proposal.created_at),
      rationale: proposal.rationale, risk: proposal.risk,
    });
    const { data: finished, error: finishError } = await current.supabase.rpc("finish_action_proposal_execution", {
      p_investigation_id: investigationId, p_proposal_id: proposalId, p_lease_id: leaseId,
      p_success: true, p_result: result, p_error: null,
    });
    if (finishError) return { ok: false as const, status: 503 as const, error: "GitHub verified the pull request, but the result could not be recorded; retry to reconcile it." };
    return { ok: true as const, data: record(finished) ? finished.result : result, duplicate: false };
  } catch {
    const { error: finishError } = await current.supabase.rpc("finish_action_proposal_execution", {
      p_investigation_id: investigationId, p_proposal_id: proposalId, p_lease_id: leaseId,
      p_success: false, p_result: null, p_error: "GitHub action failed or its outcome needs reconciliation.",
    });
    return { ok: false as const, status: finishError ? 503 as const : 502 as const,
      error: finishError ? "Execution outcome could not be recorded; retry after the execution lease expires." : "GitHub action was not verified. Retry is safe and reconciles any created branch or pull request." };
  }
}

export async function createActionProposal(request: Request, investigationId: string, body: unknown) {
  const parsed = validateActionProposal(body);
  if (!parsed.ok) return parsed;
  if (!UUID_PATTERN.test(investigationId)) {
    return { ok: false as const, status: 400 as const, error: "Action proposal input is invalid." };
  }
  const current = await workspaceSupabase(request);
  if (!current.ok) return current;
  const { type, target, inputs, evidence, rationale, risk, idempotencyKey, serialized } = parsed.value;
  const { data: failedAttempts, error: attemptsError } = await current.supabase.from("investigation_attempts")
    .select("attempt_key").eq("workspace_id", current.workspace.id).eq("investigation_id", investigationId)
    .eq("outcome", "failed").limit(101);
  if (attemptsError) return { ok: false as const, status: 503 as const, error: "Prior attempts could not be checked." };
  if ((failedAttempts ?? []).length > 100) return { ok: false as const, status: 409 as const, error: "Prior attempt history exceeds the review limit; no proposal was created." };
  const failedKeys = (failedAttempts ?? []).map((attempt) => attempt.attempt_key).filter((key): key is string => typeof key === "string");
  if (!validatePriorAttemptReview(inputs, failedKeys, evidence)) {
    return { ok: false as const, status: 400 as const, error: "Review every failed attempt and cite proposal source/version evidence before proposing." };
  }
  const contentHash = createHash("sha256").update(serialized).digest("hex");
  const values = {
    workspace_id: current.workspace.id,
    investigation_id: investigationId,
    created_by: current.workspace.userId,
    proposal_type: type,
    target,
    inputs,
    evidence,
    rationale: rationale.trim(),
    risk: risk.trim(),
    idempotency_key: idempotencyKey,
    content_hash: contentHash,
  };

  const { data, error } = await current.supabase.from("action_proposals").insert(values)
    .select("id, proposal_type, target, inputs, evidence, rationale, risk, content_hash, status, created_at").maybeSingle();
  if (!error && data) return { ok: true as const, data, duplicate: false };
  if (error?.code === "23514") return { ok: false as const, status: 400 as const, error: "Proposal evidence must reference accessible workspace source versions." };
  if (error?.code !== "23505") return { ok: false as const, status: 503 as const, error: "Action proposal could not be stored." };

  const existing = await current.supabase.from("action_proposals")
    .select("id, proposal_type, target, inputs, evidence, rationale, risk, content_hash, status, created_at")
    .eq("workspace_id", current.workspace.id).eq("investigation_id", investigationId)
    .eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing.error) return { ok: false as const, status: 503 as const, error: "Existing action proposal could not be checked." };
  if (!existing.data || existing.data.content_hash !== contentHash) {
    return { ok: false as const, status: 409 as const, error: "Idempotency key was already used for different proposal content." };
  }
  return { ok: true as const, data: existing.data, duplicate: true };
}

export async function reviewActionProposal(request: Request, investigationId: string, proposalId: string, body: unknown) {
  const current = await workspaceSupabase(request);
  if (!current.ok) return current;
  if (!UUID_PATTERN.test(investigationId) || !UUID_PATTERN.test(proposalId) || !record(body)
    || (body.decision !== "approve" && body.decision !== "reject")
    || typeof body.expectedContentHash !== "string" || !/^[0-9a-f]{64}$/.test(body.expectedContentHash)) {
    return { ok: false as const, status: 400 as const, error: "Proposal review input is invalid." };
  }
  const { data, error } = await current.supabase.rpc("review_action_proposal", {
    p_investigation_id: investigationId,
    p_proposal_id: proposalId,
    p_decision: body.decision,
    p_expected_hash: body.expectedContentHash,
  });
  if (error?.code === "22023") return { ok: false as const, status: 400 as const, error: "Proposal review input is invalid." };
  if (["40001", "42501", "P0002", "23505"].includes(error?.code ?? "")) {
    return { ok: false as const, status: error?.code === "P0002" ? 403 as const : 409 as const, error: "Proposal is unavailable to this reviewer or can no longer be reviewed." };
  }
  if (error) return { ok: false as const, status: 503 as const, error: "Proposal review could not be stored." };
  return { ok: true as const, data };
}

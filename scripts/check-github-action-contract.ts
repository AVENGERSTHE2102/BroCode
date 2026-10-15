import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createGitHubProposalPullRequest } from "../src/lib/github-app";
import { applyUnifiedPatch } from "../src/lib/github-patch";
import { validateActionProposal } from "../src/lib/action-proposals";
import { validatePriorAttemptReview } from "../src/lib/attempt-review";

const patch = "diff --git a/src/message.txt b/src/message.txt\nindex 1111111..2222222 100644\n--- a/src/message.txt\n+++ b/src/message.txt\n@@ -1,2 +1,2 @@\n hello\n-old\n+new\n";
const proposal = { type: "github_patch", target: { repository: "acme/service", ref: "main", baseSha: "a".repeat(40) },
  inputs: { title: "Fix text", patch }, evidence: [{ sourceId: "github:issue:77:1", version: "v1" }],
  rationale: "Source-backed change", risk: "Small text change", idempotencyKey: "one" };
assert.equal(validateActionProposal(proposal).ok, true);
assert.equal(validateActionProposal({ ...proposal, target: { ...proposal.target, baseSha: "moving" } }).ok, false);
const rollback = { ...proposal, type: "deployment_rollback", target: { provider: "provider-id", serviceId: "service-17", environment: "staging",
  currentRevision: "deploy-42", targetRevision: "deploy-41" }, inputs: { reason: "Known-good prior revision" }, idempotencyKey: "rollback-one" };
assert.equal(validateActionProposal(rollback).ok, true);
assert.equal(validateActionProposal({ ...rollback, target: { ...rollback.target, targetRevision: rollback.target.currentRevision } }).ok, false);
assert.equal(validateActionProposal({ ...rollback, target: { ...rollback.target, environment: "" } }).ok, false);
const previousFailures = ["rollback-v1", "patch-v2"];
assert.equal(validatePriorAttemptReview({}, previousFailures, proposal.evidence), false);
const reviewEntry = (attemptKey: string) => ({ attemptKey, applicability: "applies", explanation: "The failed approach applies to this proposal.",
  evidence: proposal.evidence, changedConditions: [{ description: "The affected revision has changed.", ...proposal.evidence[0] }] });
assert.equal(validatePriorAttemptReview({ priorAttemptReview: [reviewEntry("rollback-v1")] }, previousFailures, proposal.evidence), false);
assert.equal(validatePriorAttemptReview({ priorAttemptReview: [reviewEntry("rollback-v1"), reviewEntry("patch-v2")] }, previousFailures, proposal.evidence), true);
assert.equal(validatePriorAttemptReview({ priorAttemptReview: [reviewEntry("rollback-v1"), { ...reviewEntry("patch-v2"), changedConditions: [] }] }, previousFailures, proposal.evidence), false);
assert.equal(validatePriorAttemptReview({ priorAttemptReview: [reviewEntry("rollback-v1"), reviewEntry("patch-v2").evidence] }, previousFailures, proposal.evidence), false);
assert.deepEqual(applyUnifiedPatch(patch, new Map([[
  "src/message.txt", { content: "hello\nold\n", mode: "100644" as const },
]])), [{ path: "src/message.txt", mode: "100644", deleted: false, content: "hello\nnew\n" }]);
const add = "diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,1 @@\n+created\n";
assert.deepEqual(applyUnifiedPatch(add, new Map()), [{ path: "new.txt", mode: "100644", deleted: false, content: "created\n" }]);
const emptied = "diff --git a/empty.txt b/empty.txt\n--- a/empty.txt\n+++ b/empty.txt\n@@ -1 +0,0 @@\n-old\n";
assert.deepEqual(applyUnifiedPatch(emptied, new Map([["empty.txt", { content: "old\n", mode: "100644" as const }]])), [
  { path: "empty.txt", mode: "100644", deleted: false, content: "" },
]);
assert.throws(() => applyUnifiedPatch(patch.replace("\n hello\n", "\n nope\n"), new Map([[
  "src/message.txt", { content: "hello\nold\n", mode: "100644" as const },
]])), /context does not match/);
assert.throws(() => applyUnifiedPatch(patch.replaceAll("src/message.txt", "../message.txt"), new Map()), /unsupported/);
assert.throws(() => applyUnifiedPatch(patch.replace("@@ -1,2 +1,2 @@", "@@ -1,99 +1,2 @@"), new Map([[
  "src/message.txt", { content: "hello\nold\n", mode: "100644" as const },
]])), /hunk counts/);

const baseSha = "a".repeat(40);
const baseTree = "b".repeat(40);
const blobSha = "c".repeat(40);
const nextBlob = "d".repeat(40);
const nextTree = "e".repeat(40);
const nextCommit = "f".repeat(40);
const calls: Array<{ path: string; method: string; body: Record<string, unknown> | null; token: string }> = [];
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
let branchCreated = false;
let pullCreated = false;
let baseMoved = false;
const fetcher: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
  const token = new Headers(init?.headers).get("authorization") ?? "";
  calls.push({ path: url.pathname + url.search, method, body, token });
  if (url.pathname.endsWith("/access_tokens")) return Response.json({ token: "scoped-write", repositories: [{ id: 77 }], permissions: {
    metadata: "read", contents: "write", pull_requests: "write", checks: "read", statuses: "read",
  } });
  if (url.pathname === "/repos/acme/service/git/ref/heads/main") return Response.json({ object: { sha: baseMoved ? "9".repeat(40) : baseSha } });
  if (url.pathname === `/repos/acme/service/git/commits/${baseSha}`) return Response.json({ tree: { sha: baseTree } });
  if (url.pathname === `/repos/acme/service/git/trees/${baseTree}`) return Response.json({ truncated: false, tree: [
    { type: "blob", mode: "100644", path: "src/message.txt", sha: blobSha },
  ] });
  if (url.pathname === `/repos/acme/service/git/blobs/${blobSha}`) return Response.json({ size: 10, encoding: "base64", content: Buffer.from("hello\nold\n").toString("base64") });
  if (url.pathname === "/repos/acme/service/git/blobs" && method === "POST") {
    assert.equal(body?.content, "hello\nnew\n"); assert.equal(body?.encoding, "utf-8");
    return Response.json({ sha: nextBlob });
  }
  if (url.pathname === "/repos/acme/service/git/trees" && method === "POST") {
    assert.deepEqual(body?.tree, [{ path: "src/message.txt", mode: "100644", type: "blob", sha: nextBlob }]);
    return Response.json({ sha: nextTree });
  }
  if (url.pathname === "/repos/acme/service/git/commits" && method === "POST") {
    assert.deepEqual(body?.parents, [baseSha]);
    return Response.json({ sha: nextCommit });
  }
  if (url.pathname === "/repos/acme/service/git/ref/heads/waypoint/proposal-00000000-0000-4000-8000-000000000001") {
    if (branchCreated) return Response.json({ object: { sha: nextCommit } });
    return Response.json({ message: "Not Found" }, { status: 404 });
  }
  if (url.pathname === "/repos/acme/service/git/refs" && method === "POST") {
    assert.equal(body?.ref, "refs/heads/waypoint/proposal-00000000-0000-4000-8000-000000000001");
    branchCreated = true;
    return Response.json({ object: { sha: nextCommit } }, { status: 201 });
  }
  if (url.pathname === "/repos/acme/service/pulls" && method === "GET") return Response.json(pullCreated ? [{ number: 19, state: "open", draft: true, head: { ref: "waypoint/proposal-00000000-0000-4000-8000-000000000001", sha: nextCommit }, base: { ref: "main" }, html_url: "https://github.com/acme/service/pull/19" }] : []);
  if (url.pathname === "/repos/acme/service/pulls" && method === "POST") {
    assert.equal(body?.draft, true); assert.equal(body?.head, "waypoint/proposal-00000000-0000-4000-8000-000000000001");
    pullCreated = true;
    return Response.json({ number: 19, state: "open", draft: true, head: { ref: "waypoint/proposal-00000000-0000-4000-8000-000000000001", sha: nextCommit }, base: { ref: "main" }, html_url: "https://github.com/acme/service/pull/19" }, { status: 201 });
  }
  if (url.pathname === "/repos/acme/service/pulls/19") return Response.json({ number: 19, state: "open", draft: true, title: "Fix text", head: { ref: "waypoint/proposal-00000000-0000-4000-8000-000000000001", sha: nextCommit }, base: { ref: "main" }, html_url: "https://github.com/acme/service/pull/19" });
  if (url.pathname === `/repos/acme/service/commits/${nextCommit}/check-runs`) return Response.json({ check_runs: [{ status: "completed", conclusion: "success" }] });
  if (url.pathname === `/repos/acme/service/commits/${nextCommit}/status`) return Response.json({ state: "success", statuses: [] });
  if (url.pathname === "/installation/token" && method === "DELETE") return new Response(null, { status: 204 });
  throw new Error(`Unexpected mock request: ${method} ${url.pathname}`);
};
const result = await createGitHubProposalPullRequest({
  installationId: 8, repositoryId: 77, fullName: "acme/service", proposalId: "00000000-0000-4000-8000-000000000001",
  proposalHash: "1".repeat(64), title: "Fix text", patch, baseRef: "main", baseSha, createdAt: "2026-10-15T00:00:00.000Z",
  rationale: "The source shows the old value.", risk: "Low; one text file.",
}, { env: { GITHUB_APP_ID: "123", GITHUB_APP_PRIVATE_KEY: privateKey }, fetch: fetcher });
assert.deepEqual(result, { number: 19, url: "https://github.com/acme/service/pull/19", title: "Fix text", draft: true, commitSha: nextCommit, checks: "success" });
assert.deepEqual(calls[0].body, { repository_ids: [77], permissions: {
  metadata: "read", contents: "write", pull_requests: "write", checks: "read", statuses: "read",
} });
assert.ok(calls.slice(1, -1).every((call) => call.token === "Bearer scoped-write"));
assert.equal(calls.at(-1)?.method, "DELETE");
assert.equal(calls.some((call) => call.method === "PUT" || /\/merge(?:\?|$)/.test(call.path)), false);
const firstExternalCreates = calls.filter((call) => call.method === "POST" && ["/repos/acme/service/git/refs", "/repos/acme/service/pulls"].includes(call.path)).length;
const baseChecks = calls.filter((call) => call.path === "/repos/acme/service/git/ref/heads/main").length;
baseMoved = true;
const retry = await createGitHubProposalPullRequest({
  installationId: 8, repositoryId: 77, fullName: "acme/service", proposalId: "00000000-0000-4000-8000-000000000001",
  proposalHash: "1".repeat(64), title: "Fix text", patch, baseRef: "main", baseSha, createdAt: "2026-10-15T00:00:00.000Z",
  rationale: "The source shows the old value.", risk: "Low; one text file.",
}, { env: { GITHUB_APP_ID: "123", GITHUB_APP_PRIVATE_KEY: privateKey }, fetch: fetcher });
assert.deepEqual(retry, result);
assert.equal(calls.filter((call) => call.method === "POST" && ["/repos/acme/service/git/refs", "/repos/acme/service/pulls"].includes(call.path)).length, firstExternalCreates);
assert.equal(calls.filter((call) => call.path === "/repos/acme/service/git/ref/heads/main").length, baseChecks);
const migration = await readFile(new URL("../supabase/migrations/202610150012_action_execution.sql", import.meta.url), "utf8");
assert.match(migration, /join public\.workspace_memberships m[\s\S]*m\.role in \('owner', 'admin'\)/i);
assert.match(migration, /approval\.decision <> 'approve'/i);
assert.match(migration, /proposal\.content_hash <> p_expected_hash/i);
assert.match(migration, /interval '24 hours'/i);
assert.match(migration, /execution_lease_until = now\(\) \+ interval '10 minutes'/i);
assert.match(migration, /status = 'succeeded'/i);
assert.match(migration, /create function public\.finish_action_proposal_execution/i);
const executeRoute = await readFile(new URL("../src/app/api/investigations/[id]/action-proposals/[proposalId]/execute/route.ts", import.meta.url), "utf8");
assert.match(executeRoute, /executeActionProposal/);
assert.match(executeRoute, /request\.headers\.get\("origin"\) !== new URL\(request\.url\)\.origin/);
const evidenceMigration = await readFile(new URL("../supabase/migrations/202610150019_action_proposal_source_validation.sql", import.meta.url), "utf8");
assert.match(evidenceMigration, /workspace_source_version_accessible\([\s\S]*evidence\.value ->> 'sourceId',[\s\S]*evidence\.value ->> 'version'/i);
assert.match(evidenceMigration, /jsonb_typeof\(new\.evidence\) is distinct from 'array'/i);
assert.match(evidenceMigration, /before insert or update of workspace_id, evidence on public\.action_proposals/i);
assert.match(evidenceMigration, /using errcode = '23514'/i);
const proposalService = await readFile(new URL("../src/lib/action-proposals.ts", import.meta.url), "utf8");
assert.match(proposalService, /error\?\.code === "23514"[\s\S]*accessible workspace source versions/);
console.log("GitHub action execution contract checks passed.");

import assert from "node:assert/strict";
import { createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { authorizeGitHubInstallation, createGitHubAppJwt, createGitHubInstallState, listGitHubInstallationRepositories, readGitHubRepositorySnapshot, verifyGitHubInstallState, verifyGitHubRepositoryAccess } from "../src/lib/github-app";
import { toGitHubImportRecords, toGitHubSecurityImportRecords } from "../src/lib/github-source-import";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const env = { GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: privatePem };
const jwt = createGitHubAppJwt("12345", privatePem, 1_800_000_000);
const [header, claims, signature] = jwt.split(".");
const verifier = createVerify("RSA-SHA256");
verifier.update(`${header}.${claims}`);
assert.equal(verifier.verify(publicKey, signature, "base64url"), true);
assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url").toString()), { iat: 1_799_999_940, exp: 1_800_000_540, iss: "12345" });
const installState = createGitHubInstallState("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "s".repeat(40), 1_800_000_000_000);
assert.equal(verifyGitHubInstallState(installState.state, installState.nonce, "s".repeat(40), 1_800_000_100_000)?.workspaceId, installState.workspaceId);
assert.equal(verifyGitHubInstallState(installState.state, "wrong", "s".repeat(40), 1_800_000_100_000), null);
assert.equal(verifyGitHubInstallState(`${installState.state}x`, installState.nonce, "s".repeat(40), 1_800_000_100_000), null);
assert.equal(verifyGitHubInstallState(installState.state, installState.nonce, "s".repeat(40), 1_800_001_000_000), null);

const oauthEnv = { GITHUB_APP_CLIENT_ID: "client-123", GITHUB_APP_CLIENT_SECRET: "client-secret" };
const oauthCalls: Array<{ url: string; method: string; auth: string; body: Record<string, unknown> | null }> = [];
const oauthFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
  const auth = new Headers(init?.headers).get("authorization") ?? "";
  oauthCalls.push({ url, method: init?.method ?? "GET", auth, body });
  if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "temporary-user-token" });
  if (url === "https://api.github.com/user") return Response.json({ id: 77, login: "octo-admin" });
  if (url.startsWith("https://api.github.com/user/installations?")) return Response.json({ installations: [{ id: 7 }] });
  if (url === "https://api.github.com/applications/client-123/token" && init?.method === "DELETE") return new Response(null, { status: 204 });
  throw new Error(`Unexpected mocked OAuth request: ${url}`);
};
assert.deepEqual(await authorizeGitHubInstallation("one-time-code", 7, { env: oauthEnv, fetch: oauthFetch }), { installationId: 7, githubUserId: 77, githubLogin: "octo-admin" });
assert.equal(oauthCalls[2].auth, "Bearer temporary-user-token");
assert.equal(oauthCalls[3].method, "DELETE");
assert.match(oauthCalls[3].auth, /^Basic /);
await assert.rejects(() => authorizeGitHubInstallation("one-time-code", 8, { env: oauthEnv, fetch: oauthFetch }), /not authorized/);

const listedCalls: Array<{ path: string; method: string; token: string; body: Record<string, unknown> | null }> = [];
const listingFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
  const token = new Headers(init?.headers).get("authorization") ?? "";
  listedCalls.push({ path: url.pathname + url.search, method: init?.method ?? "GET", token, body });
  if (url.pathname.endsWith("/access_tokens")) return Response.json({ token: "metadata-only", permissions: { metadata: "read" } });
  if (url.pathname === "/installation/repositories") return Response.json({ total_count: 1, repositories: [{ id: 321, full_name: "acme/service", private: true }] });
  if (url.pathname === "/installation/token" && init?.method === "DELETE") return new Response(null, { status: 204 });
  throw new Error(`Unexpected mocked GitHub request: ${url.pathname}`);
};
assert.deepEqual(await listGitHubInstallationRepositories(7, { env, fetch: listingFetch }), { repositories: [{ id: 321, fullName: "acme/service", private: true }], truncated: false });
assert.deepEqual(listedCalls[0].body, { permissions: { metadata: "read" } });
assert.equal(listedCalls[1].token, "Bearer metadata-only");
assert.equal(listedCalls[2].method, "DELETE");

const scopedCalls: Array<{ path: string; method: string; token: string; body: Record<string, unknown> | null }> = [];
const scopedFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
  const token = new Headers(init?.headers).get("authorization") ?? "";
  scopedCalls.push({ path: url.pathname, method: init?.method ?? "GET", token, body });
  if (url.pathname.endsWith("/access_tokens")) return Response.json({
    token: "single-repository-token", repositories: [{ id: 321 }],
    permissions: { metadata: "read", contents: "read", issues: "read", pull_requests: "read", checks: "read" },
  });
  if (url.pathname === "/repos/acme/service") return Response.json({ id: 321, full_name: "acme/service", default_branch: "main", updated_at: "2026-10-01T00:00:00Z", html_url: "https://github.com/acme/service" });
  if (url.pathname === "/installation/token" && init?.method === "DELETE") return new Response(null, { status: 204 });
  throw new Error(`Unexpected mocked GitHub request: ${url.pathname}`);
};
assert.deepEqual(await verifyGitHubRepositoryAccess(7, 321, "acme/service", { env, fetch: scopedFetch }), {
  id: 321, fullName: "acme/service", defaultBranch: "main", updatedAt: "2026-10-01T00:00:00Z", url: "https://github.com/acme/service",
});
assert.deepEqual(scopedCalls[0].body, {
    repository_ids: [321], permissions: { metadata: "read", contents: "read", issues: "read", pull_requests: "read", checks: "read" },
});
assert.equal(scopedCalls[1].token, "Bearer single-repository-token");
assert.equal(scopedCalls[2].method, "DELETE");
await assert.rejects(() => verifyGitHubRepositoryAccess(7, 322, "acme/service", { env, fetch: scopedFetch }), /restricted to the selected repository/);

const snapshotCalls: Array<{ path: string; method: string; token: string; body: Record<string, unknown> | null }> = [];
const snapshotFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const token = new Headers(init?.headers).get("authorization") ?? "";
  const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
  snapshotCalls.push({ path: url.pathname + url.search, method: init?.method ?? "GET", token, body });
  if (url.pathname.endsWith("/access_tokens")) return Response.json(body?.permissions && "vulnerability_alerts" in (body.permissions as object)
    ? { token: "dependabot-token", repositories: [{ id: 321 }], permissions: { vulnerability_alerts: "read" } }
    : { token: "snapshot-token", repositories: [{ id: 321 }], permissions: { metadata: "read", contents: "read", issues: "read", pull_requests: "read", checks: "read" } });
  if (url.pathname === "/repos/acme/service") return Response.json({ id: 321, full_name: "acme/service", default_branch: "main" });
  if (url.pathname === "/repos/acme/service/commits") return Response.json([{ sha: "a".repeat(40), html_url: "https://github.com/acme/service/commit/" + "a".repeat(40), commit: { message: "Fix bug\nDetails", author: { name: "Octo", date: "2026-10-01T00:00:00Z" } } }]);
  if (url.pathname === "/repos/acme/service/issues") return Response.json([
    { id: 9, title: "Issue", body: "Issue detail", html_url: "https://github.com/acme/service/issues/9", updated_at: "2026-10-02T00:00:00Z", user: { login: "octo" } },
    { id: 10, pull_request: {}, title: "PR mirrored in issues" },
  ]);
  if (url.pathname === "/repos/acme/service/pulls") return Response.json([{ id: 11, number: 11, title: "Pull request", body: "Review", html_url: "https://github.com/acme/service/pull/11", updated_at: "2026-10-03T00:00:00Z", user: { login: "octo" } }]);
  if (url.pathname === "/repos/acme/service/pulls/11/files") return Response.json([{ filename: "src/app.ts", sha: "e".repeat(40), status: "modified" }]);
  if (url.pathname === "/repos/acme/service/git/ref/heads/main") return Response.json({ object: { sha: "b".repeat(40) } });
  if (url.pathname === "/repos/acme/service/commits/" + "b".repeat(40) + "/check-runs") return Response.json({ total_count: 1, check_runs: [
    { id: 77, name: "unit-tests", head_sha: "b".repeat(40), status: "completed", conclusion: "success",
      started_at: "2026-10-04T00:00:00Z", completed_at: "2026-10-04T00:01:00Z",
      html_url: "https://github.com/acme/service/actions/runs/77", output: { title: "Unit tests passed", summary: "42 tests passed" }, app: { name: "GitHub Actions" } },
  ] });
  if (url.pathname === "/repos/acme/service/git/trees/" + "b".repeat(40)) return Response.json({ truncated: false, tree: [
    { type: "blob", path: "src/app.ts", sha: "c".repeat(40) }, { type: "tree", path: "src", sha: "d".repeat(40) },
  ] });
  if (url.pathname === "/repos/acme/service/dependabot/alerts") return Response.json([{
    number: 17, state: "open", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-04T00:00:00Z",
    dependency: { package: { ecosystem: "npm", name: "lodash" }, manifest_path: "package-lock.json", scope: "runtime" },
    security_advisory: { ghsa_id: "GHSA-1234-5678-9abc", cve_id: "CVE-2026-1234", summary: "Prototype pollution", description: "A test advisory.", cvss: { score: 7.5 }, cwes: [{ cwe_id: "CWE-1321" }] },
    security_vulnerability: { package: { ecosystem: "npm", name: "lodash" }, severity: "high", vulnerable_version_range: ">= 4.0.0, < 4.17.21", first_patched_version: { identifier: "4.17.21" } },
  }]);
  if (url.pathname === "/installation/token" && init?.method === "DELETE") return new Response(null, { status: 204 });
  throw new Error(`Unexpected mocked snapshot request: ${url.pathname}`);
};
const snapshot = await readGitHubRepositorySnapshot(7, 321, "acme/service", { env, fetch: snapshotFetch });
assert.equal(snapshot.items.length, 6);
assert.equal(snapshot.items.filter((item) => item.kind === "issue").length, 1);
assert.equal(snapshot.items.find((item) => item.kind === "commit")?.sourceVersion, "a".repeat(40));
assert.equal(snapshot.items.find((item) => item.kind === "file")?.path, "src/app.ts");
assert.equal(snapshot.items.find((item) => item.kind === "check_run")?.sourceId, "github:check_run:321:77");
assert.equal(snapshot.items.find((item) => item.kind === "check_run")?.details?.conclusion, "success");
assert.deepEqual(snapshot.items.find((item) => item.kind === "pull_request")?.details?.changedFiles, [
  { path: "src/app.ts", sha: "e".repeat(40), status: "modified" },
]);
assert.equal(snapshot.items.find((item) => item.kind === "pull_request")?.details?.filesSourceVersion, "2026-10-03T00:00:00Z");
const finding = snapshot.items.find((item) => item.kind === "security_finding");
assert.equal(finding?.sourceId, "github:security:321:17");
assert.equal(finding?.sourceVersion, "2026-10-04T00:00:00Z");
assert.equal(finding?.details?.firstPatchedVersion, "4.17.21");
assert.equal(snapshot.partialErrors.length, 0);
const oversizedCheckFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith("/check-runs")) return Response.json({ total_count: 101, check_runs: Array.from({ length: 101 }, (_, index) => ({
    id: index + 1, name: `check-${index + 1}`, head_sha: "b".repeat(40), status: "completed", conclusion: "success",
    completed_at: "2026-10-04T00:01:00Z", html_url: `https://github.com/acme/service/actions/runs/${index + 1}`,
  })) });
  return snapshotFetch(input, init);
};
const oversizedSnapshot = await readGitHubRepositorySnapshot(7, 321, "acme/service", { env, fetch: oversizedCheckFetch });
assert.equal(oversizedSnapshot.items.filter((item) => item.kind === "check_run").length, 100);
assert.ok(oversizedSnapshot.partialErrors.includes("The default-branch head has more than 100 check runs; only the first 100 were imported."));
const failedCheckFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith("/check-runs") || url.pathname === "/repos/acme/service/pulls/11/files") {
    return Response.json({ message: "Read permission missing" }, { status: 403 });
  }
  return snapshotFetch(input, init);
};
const failedCheckSnapshot = await readGitHubRepositorySnapshot(7, 321, "acme/service", { env, fetch: failedCheckFetch });
assert.equal(failedCheckSnapshot.items.some((item) => item.kind === "issue"), true);
assert.ok(failedCheckSnapshot.partialErrors.includes("Default-branch check runs could not be imported."));
assert.ok(failedCheckSnapshot.partialErrors.includes("Some pull request changed-file metadata could not be imported."));
assert.equal(failedCheckSnapshot.items.find((item) => item.kind === "pull_request")?.details, undefined);
const oversizedPullFilesFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.pathname === "/repos/acme/service/pulls/11/files") return Response.json(Array.from({ length: 20 }, (_, index) => ({
    filename: `${index}-${"é".repeat(398)}`, sha: "f".repeat(40), status: "modified",
  })));
  return snapshotFetch(input, init);
};
const oversizedPullFilesSnapshot = await readGitHubRepositorySnapshot(7, 321, "acme/service", { env, fetch: oversizedPullFilesFetch });
const changedFileDetails = oversizedPullFilesSnapshot.items.find((item) => item.kind === "pull_request")?.details;
assert.ok(Buffer.byteLength(JSON.stringify(changedFileDetails ?? {})) <= 10_000);
assert.ok(oversizedPullFilesSnapshot.partialErrors.includes("A pull request changed-file list was truncated or contained unsupported file metadata."));
assert.deepEqual(snapshotCalls.filter((call) => call.method === "POST").slice(0, 2).map((call) => call.body?.permissions), [
  { metadata: "read", contents: "read", issues: "read", pull_requests: "read", checks: "read" }, { vulnerability_alerts: "read" },
]);
assert.ok(snapshotCalls.filter((call) => call.method === "GET" && call.path !== "/repos/acme/service").every((call) =>
  call.token === "Bearer snapshot-token" || call.token === "Bearer dependabot-token"));
assert.deepEqual(snapshotCalls.filter((call) => call.method === "DELETE").map((call) => call.token).sort(), [
  "Bearer dependabot-token", "Bearer dependabot-token", "Bearer dependabot-token", "Bearer dependabot-token",
  "Bearer snapshot-token", "Bearer snapshot-token", "Bearer snapshot-token", "Bearer snapshot-token",
]);

assert.equal(snapshot.headCommitSha, "b".repeat(40));
assert.equal(snapshot.incremental, false);

const incrementalCalls: string[] = [];
const incrementalFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  incrementalCalls.push(url.pathname + url.search);
  return snapshotFetch(input, init);
};
const incrementalSameHeadSnapshot = await readGitHubRepositorySnapshot(7, 321, "acme/service", {
  env, fetch: incrementalFetch, since: "2026-10-01T00:00:00Z", previousCommitSha: "b".repeat(40),
});
assert.equal(incrementalSameHeadSnapshot.incremental, true);
assert.equal(incrementalSameHeadSnapshot.items.some((item) => item.kind === "file"), false, "no file items expected when the previous head SHA matches the current one");
assert.ok(incrementalCalls.some((call) => call.startsWith("/repos/acme/service/commits?since=2026-10-01T00%3A00%3A00Z")));
assert.ok(incrementalCalls.some((call) => call.startsWith("/repos/acme/service/issues?state=all&since=2026-10-01T00%3A00%3A00Z")));
assert.ok(incrementalCalls.every((call) => !call.startsWith("/repos/acme/service/git/trees/")), "a matching head SHA must skip the full tree walk");
assert.ok(incrementalCalls.every((call) => !call.startsWith("/repos/acme/service/compare/")), "a matching head SHA must skip the compare diff too");

const compareFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.pathname === "/repos/acme/service/compare/" + "9".repeat(40) + "..." + "b".repeat(40)) {
    return Response.json({ status: "ahead", files: [
      { filename: "src/changed.ts", sha: "f".repeat(40), status: "modified" },
      { filename: "src/removed.ts", status: "removed" },
    ] });
  }
  return snapshotFetch(input, init);
};
const incrementalChangedHeadSnapshot = await readGitHubRepositorySnapshot(7, 321, "acme/service", {
  env, fetch: compareFetch, previousCommitSha: "9".repeat(40),
});
assert.deepEqual(incrementalChangedHeadSnapshot.items.filter((item) => item.kind === "file").map((item) => item.path), ["src/changed.ts"]);

const compareFailsFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.pathname.startsWith("/repos/acme/service/compare/")) return Response.json({ message: "No common ancestor" }, { status: 404 });
  return snapshotFetch(input, init);
};
const compareFallbackSnapshot = await readGitHubRepositorySnapshot(7, 321, "acme/service", {
  env, fetch: compareFailsFetch, previousCommitSha: "9".repeat(40),
});
assert.ok(compareFallbackSnapshot.partialErrors.some((error) => error.includes("imported the full file tree instead")));
assert.equal(compareFallbackSnapshot.items.find((item) => item.kind === "file")?.path, "src/app.ts", "compare failure must fall back to a full tree walk");

const source = {
  workspaceId: "00000000-0000-4000-8000-000000000001", sourceId: "00000000-0000-4000-8000-000000000002",
  repositoryId: 321, fullName: "acme/service", htmlUrl: "https://github.com/acme/service", defaultBranch: "main", providerUpdatedAt: null,
};
const records = toGitHubImportRecords(source, snapshot.items, "2026-10-04T00:00:00Z");
assert.equal(records.length, snapshot.items.length);
assert.equal(records[0].record_id, "github:repo:321");
assert.equal(records.find((record) => record.record_type === "commit")?.provider_version, "a".repeat(40));
assert.equal(records.find((record) => record.record_type === "file")?.record_id, "github:file:321:src/app.ts");
assert.equal(records.find((record) => record.record_type === "check_run")?.details?.headSha, "b".repeat(40));
assert.equal((records.find((record) => record.record_type === "pull_request")?.details?.changedFiles as Array<{ path: string }>)[0]?.path, "src/app.ts");
assert.equal("details" in (toGitHubImportRecords(source, failedCheckSnapshot.items, "2026-10-04T00:00:00Z")
  .find((record) => record.record_type === "pull_request") ?? {}), false);
assert.equal(toGitHubImportRecords(source, snapshot.items, "2026-10-05T00:00:00Z")[1].record_id, records[1].record_id);
const securityRecords = toGitHubSecurityImportRecords(source, snapshot.items, "2026-10-04T00:00:00Z");
assert.equal(securityRecords.length, 1);
assert.equal(securityRecords[0].record_type, "security_finding");
assert.deepEqual(securityRecords[0].details, finding?.details);

const migration = await readFile(new URL("../supabase/migrations/202610150008_github_sources.sql", import.meta.url), "utf8");
const recordsMigration = await readFile(new URL("../supabase/migrations/202610150009_github_source_records.sql", import.meta.url), "utf8");
const historyMigration = await readFile(new URL("../supabase/migrations/202610150010_github_record_history.sql", import.meta.url), "utf8");
const securityMigration = await readFile(new URL("../supabase/migrations/202610150013_github_security_findings.sql", import.meta.url), "utf8");
const checkRunMigration = await readFile(new URL("../supabase/migrations/202610150018_github_check_run_evidence.sql", import.meta.url), "utf8");
assert.match(migration, /enable row level security/i);
assert.match(migration, /workspace admins can remove GitHub sources/i);
assert.match(migration, /references public\.workspace_github_installations\(workspace_id, installation_id\)/);
assert.match(migration, /grant select, delete on public\.workspace_github_installations to authenticated/i);
assert.doesNotMatch(migration, /grant [^;]*insert[^;]*workspace_github_installations to authenticated/i);
assert.match(migration, /create function public\.bind_workspace_github_installation/i);
assert.match(migration, /create function public\.create_workspace_github_source/i);
assert.doesNotMatch(migration, /grant [^;]*insert[^;]*workspace_github_sources to authenticated/i);
assert.match(await readFile(new URL("../src/app/api/sources/github/callback/route.ts", import.meta.url), "utf8"), /bind_workspace_github_installation/);
assert.match(await readFile(new URL("../src/app/api/sources/github/route.ts", import.meta.url), "utf8"), /create_workspace_github_source/);
assert.match(await readFile(new URL("../src/app/api/sources/github/repositories/route.ts", import.meta.url), "utf8"), /workspace_github_installations/);
assert.doesNotMatch(migration, /access_token|private_key|secret/i);
const syncRoute = await readFile(new URL("../src/app/api/sources/github/[sourceId]/sync/route.ts", import.meta.url), "utf8");
assert.match(syncRoute, /workspaceSupabase/);
assert.match(syncRoute, /\["owner", "admin"\]/);
assert.match(syncRoute, /readGitHubRepositorySnapshot/);
assert.match(syncRoute, /sync_workspace_github_records/);
assert.match(syncRoute, /begin_workspace_github_sync/);
assert.match(syncRoute, /finish_workspace_github_sync/);
assert.match(syncRoute, /slice\(0, 18\)/);
assert.match(syncRoute, /createAdminClient\(\)[\s\S]*catch \{ return NextResponse\.json\(\{ error: "GitHub sync could not be started\." \}/);
assert.doesNotMatch(syncRoute, /withWorkspaceGraph/);
assert.match(recordsMigration, /unique \(github_source_id, record_id\)/i);
assert.match(recordsMigration, /after insert or update or delete on public\.workspace_github_records/i);
assert.match(recordsMigration, /create function public\.sync_workspace_github_records/i);
assert.match(recordsMigration, /grant execute on function public\.sync_workspace_github_records\(uuid, uuid, uuid, jsonb\) to service_role/i);
assert.match(recordsMigration, /payload - 'captured_at' is distinct from excluded\.payload - 'captured_at'/i);
assert.match(historyMigration, /create table public\.workspace_github_record_versions/i);
assert.match(historyMigration, /unique \(current_record_id, version\)/i);
assert.match(historyMigration, /before update of provider_version, payload on public\.workspace_github_records/i);
assert.match(historyMigration, /old\.provider_version, old\.version, old\.payload/i);
assert.match(historyMigration, /after insert or delete on public\.workspace_github_record_versions/i);
assert.match(historyMigration, /on delete cascade/i);
assert.doesNotMatch(historyMigration, /grant [^;]*insert[^;]*workspace_github_record_versions to authenticated/i);
assert.match(securityMigration, /record_type <> 'security_finding' or m\.role in \('owner', 'admin'\)/i);
assert.match(securityMigration, /create function public\.sync_workspace_github_security_findings/i);
assert.match(securityMigration, /auth\.role\(\) is distinct from 'service_role'/i);
assert.match(securityMigration, /grant execute on function public\.sync_workspace_github_security_findings\(uuid, uuid, uuid, jsonb\) to service_role/i);
assert.match(checkRunMigration, /record_kind not in \([^)]*'check_run'/i);
assert.match(checkRunMigration, /headSha/i);
assert.match(checkRunMigration, /Pull request changed-file evidence is invalid/);
assert.match(checkRunMigration, /jsonb_array_length\(details_value -> 'changedFiles'\) > 20/i);
assert.match(checkRunMigration, /changedFilesTruncated' = 'true'/);
assert.match(checkRunMigration, /payload \|\| \(excluded\.payload - 'details'\)/);
assert.match(checkRunMigration, /filesSourceVersion/i);
const syncStateMigration = await readFile(new URL("../supabase/migrations/202610150020_github_sync_status.sql", import.meta.url), "utf8");
assert.match(syncStateMigration, /create table public\.workspace_github_sync_state/i);
assert.match(syncStateMigration, /role in \('owner', 'admin'\)/i);
assert.match(syncStateMigration, /create function public\.begin_workspace_github_sync/i);
assert.match(syncStateMigration, /create function public\.finish_workspace_github_sync/i);
assert.match(syncStateMigration, /run_id = p_run_id[\s\S]*status = 'running'/i);
assert.match(syncStateMigration, /partial_errors jsonb[\s\S]*jsonb_array_length\(partial_errors\) <= 20/i);
assert.doesNotMatch(syncStateMigration, /grant [^;]*(insert|update)[^;]*workspace_github_sync_state to authenticated/i);
const sourceRoute = await readFile(new URL("../src/app/api/sources/github/route.ts", import.meta.url), "utf8");
assert.match(sourceRoute, /workspace_github_sync_state/);
assert.match(sourceRoute, /\["owner", "admin"\]/);
const projection = await readFile(new URL("../src/lib/graph-projection.ts", import.meta.url), "utf8");
const sourcePanel = await readFile(new URL("../src/app/github-source-panel.tsx", import.meta.url), "utf8");
assert.match(sourcePanel, /check_run: checkRun = 0/);
assert.match(sourcePanel, /\$\{checkRun\} CI check runs/);
assert.match(sourcePanel, /source\.last_sync\.status/);
assert.match(sourcePanel, /source\.last_sync\.partial_errors\.join/);
assert.match(sourcePanel, /body\.statusWarning/);
assert.match(projection, /event\.entity_type === "workspace_github_records"/);
assert.match(projection, /event\.entity_type === "workspace_github_record_versions"/);
assert.match(projection, /"HAS_ISSUE"/);
assert.match(projection, /"HAS_PULL_REQUEST"/);
assert.match(projection, /SourceRevision/);
assert.match(projection, /HAS_REVISION/);
assert.match(projection, /HAS_SECURITY_FINDING/);
assert.match(projection, /HAS_CHECK_RUN/);
assert.match(projection, /CHANGED_FILE/);
assert.match(projection, /MERGE \(n:\$\{label\} \{source_id: \$source_id\}\)/);
assert.match(projection, /file_source_version: text\(details\.filesSourceVersion\)/);
assert.match(projection, /head_commit_source_id/);
assert.match(projection, /acl_role = 'admin'/);
assert.match(projection, /security_finding/);
assert.match(projection, /r\.id = \$entity_id/);
assert.match(projection, /r\.source_id = \$source_id/);
console.log("GitHub App source connection contract checks passed.");

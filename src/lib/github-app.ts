import { createHmac, createSign, randomBytes, timingSafeEqual } from "node:crypto";
import { applyUnifiedPatch, unifiedPatchPaths } from "@/lib/github-patch";

const API = "https://api.github.com";
const API_VERSION = "2026-03-10";
const MAX_RESPONSE_BYTES = 2_000_000;
const PERMISSIONS = { metadata: "read", contents: "read", issues: "read", pull_requests: "read", checks: "read" } as const;
const SECURITY_READ_PERMISSIONS = { vulnerability_alerts: "read" } as const;
const ACTION_PERMISSIONS = { metadata: "read", contents: "write", pull_requests: "write", checks: "read", statuses: "read" } as const;
type GitHubConfig = { appId: string; privateKey: string };
type GitHubFetch = typeof fetch;

export type GitHubInstallState = { nonce: string; workspaceId: string; userId: string; expiresAt: number };

export function createGitHubInstallState(workspaceId: string, userId: string, secret: string, now = Date.now()): GitHubInstallState & { state: string } {
  if (secret.length < 32) throw new Error("GitHub OAuth state secret must contain at least 32 characters.");
  const payload = { nonce: randomBytes(32).toString("base64url"), workspaceId, userId, expiresAt: Math.floor(now / 1000) + 600 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return { ...payload, state: `${encoded}.${signature}` };
}

export function verifyGitHubInstallState(state: string, nonce: string, secret: string, now = Date.now()): GitHubInstallState | null {
  if (secret.length < 32 || state.length > 2048 || nonce.length > 100) return null;
  const [encoded, signature, extra] = state.split(".");
  if (!encoded || !signature || extra !== undefined) return null;
  const expected = createHmac("sha256", secret).update(encoded).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString()) as Partial<GitHubInstallState>;
    if (typeof payload.nonce !== "string" || payload.nonce !== nonce || typeof payload.workspaceId !== "string"
      || typeof payload.userId !== "string" || typeof payload.expiresAt !== "number" || payload.expiresAt <= Math.floor(now / 1000)) return null;
    return payload as GitHubInstallState;
  } catch { return null; }
}

function config(env: Record<string, string | undefined> = process.env): GitHubConfig {
  const appId = env.GITHUB_APP_ID?.trim();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.replaceAll("\\n", "\n");
  if (!appId || !/^\d{1,20}$/.test(appId) || !privateKey?.includes("-----BEGIN ") || !privateKey.includes("PRIVATE KEY-----")) {
    throw new Error("GitHub App credentials are not configured.");
  }
  return { appId, privateKey };
}

export function createGitHubAppJwt(appId: string, privateKey: string, now = Math.floor(Date.now() / 1000)) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: appId })}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  return `${unsigned}.${signer.sign(privateKey, "base64url")}`;
}

function positiveId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

async function githubJson<T>(path: string, token: string, method = "GET", body?: unknown, fetcher: GitHubFetch = fetch): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid GitHub API path.");
  const response = await fetcher(`${API}${path}`, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": API_VERSION, "user-agent": "Waypoint", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 204) return undefined as T;
  const size = Number(response.headers.get("content-length") ?? 0);
  if (size > MAX_RESPONSE_BYTES) throw new Error("GitHub response exceeds the size limit.");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error("GitHub response exceeds the size limit.");
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}).`);
  try { return JSON.parse(text) as T; } catch { throw new Error("GitHub returned invalid JSON."); }
}

async function createInstallationToken(installationId: number, token: string, body: Record<string, unknown>, fetcher: GitHubFetch): Promise<{ token: string; repositories?: unknown; permissions?: unknown }> {
  const result = await githubJson<{ token?: unknown; repositories?: unknown; permissions?: unknown }>(`/app/installations/${installationId}/access_tokens`, token, "POST", body, fetcher);
  if (typeof result.token !== "string" || !result.token) throw new Error("GitHub did not issue an installation token.");
  return { token: result.token, repositories: result.repositories, permissions: result.permissions };
}

async function revokeInstallationToken(token: string, fetcher: GitHubFetch) {
  await githubJson<void>("/installation/token", token, "DELETE", undefined, fetcher);
}

function hasReadOnlyPermissions(value: unknown, expected: Record<string, string>) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const permissions = value as Record<string, unknown>;
  return Object.keys(permissions).sort().join(",") === Object.keys(expected).sort().join(",")
    && Object.entries(expected).every(([name, permission]) => permissions[name] === permission);
}

export async function listGitHubInstallationRepositories(
  installationId: number,
  options: { env?: Record<string, string | undefined>; fetch?: GitHubFetch } = {},
) {
  if (!positiveId(installationId)) throw new Error("Installation ID is invalid.");
  const { appId, privateKey } = config(options.env);
  const fetcher = options.fetch ?? fetch;
  const appToken = createGitHubAppJwt(appId, privateKey);
  const metadataToken = await createInstallationToken(installationId, appToken, { permissions: { metadata: "read" } }, fetcher);
  if (!hasReadOnlyPermissions(metadataToken.permissions, { metadata: "read" })) {
    await revokeInstallationToken(metadataToken.token as string, fetcher).catch(() => undefined);
    throw new Error("GitHub token permissions exceed read-only metadata access.");
  }
  const token = metadataToken.token;
  try {
    const repositories: { id?: unknown; full_name?: unknown; private?: unknown }[] = [];
    let totalCount = 0;
    for (let page = 1; page <= 5; page++) {
      const data = await githubJson<{ repositories?: unknown; total_count?: unknown }>(`/installation/repositories?per_page=100&page=${page}`, token, "GET", undefined, fetcher);
      if (!Array.isArray(data.repositories)) throw new Error("GitHub repository list is invalid.");
      if (typeof data.total_count === "number") totalCount = data.total_count;
      const pageItems = data.repositories.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        .map((item) => ({ id: item.id, full_name: item.full_name, private: item.private }));
      repositories.push(...pageItems);
      if (data.repositories.length < 100) break;
    }
    const items = repositories.flatMap((item) => positiveId(item.id) && typeof item.full_name === "string"
      ? [{ id: item.id, fullName: item.full_name, private: item.private === true }] : []).slice(0, 500);
    return { repositories: items, truncated: totalCount > items.length };
  } finally {
    await revokeInstallationToken(token, fetcher).catch(() => undefined);
  }
}

export async function verifyGitHubRepositoryAccess(
  installationId: number,
  repositoryId: number,
  fullName: string,
  options: { env?: Record<string, string | undefined>; fetch?: GitHubFetch } = {},
) {
  if (!positiveId(installationId) || !positiveId(repositoryId) || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(fullName)
    || fullName.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("GitHub repository selection is invalid.");
  }
  const { appId, privateKey } = config(options.env);
  const fetcher = options.fetch ?? fetch;
  const appToken = createGitHubAppJwt(appId, privateKey);
  const issued = await createInstallationToken(installationId, appToken, {
    repository_ids: [repositoryId], permissions: PERMISSIONS,
  }, fetcher);
  if (!Array.isArray(issued.repositories) || !issued.repositories.some((repository) =>
    typeof repository === "object" && repository !== null && (repository as Record<string, unknown>).id === repositoryId)
    || !hasReadOnlyPermissions(issued.permissions, PERMISSIONS)) {
    await revokeInstallationToken(issued.token as string, fetcher).catch(() => undefined);
    throw new Error("GitHub token is not restricted to the selected repository and read-only permissions.");
  }
  const token = issued.token as string;
  try {
    const [owner, repo] = fullName.split("/");
    const result = await githubJson<{ id?: unknown; full_name?: unknown; default_branch?: unknown; updated_at?: unknown; html_url?: unknown }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token, "GET", undefined, fetcher,
    );
    if (result.id !== repositoryId || typeof result.full_name !== "string" || result.full_name.toLowerCase() !== fullName.toLowerCase()) {
      throw new Error("GitHub repository identity does not match the selected repository.");
    }
    if (typeof result.html_url === "string" && new URL(result.html_url).origin !== "https://github.com") {
      throw new Error("GitHub returned an invalid repository URL.");
    }
    return {
      id: repositoryId,
      fullName: result.full_name as string,
      defaultBranch: typeof result.default_branch === "string" ? result.default_branch : "",
      updatedAt: typeof result.updated_at === "string" ? result.updated_at : null,
      url: typeof result.html_url === "string" ? result.html_url : `https://github.com/${fullName}`,
    };
  } finally {
    await revokeInstallationToken(token, fetcher).catch(() => undefined);
  }
}

export type GitHubSnapshotItem = {
  kind: "commit" | "issue" | "pull_request" | "file" | "check_run" | "security_finding";
  sourceId: string;
  sourceVersion: string;
  title: string;
  body: string;
  url: string;
  updatedAt: string;
  path: string;
  author: string;
  details?: Record<string, unknown>;
};

export async function readGitHubDependabotAlerts(
  installationId: number,
  repositoryId: number,
  fullName: string,
  options: { env?: Record<string, string | undefined>; fetch?: GitHubFetch } = {},
) {
  if (!positiveId(installationId) || !positiveId(repositoryId)
    || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(fullName)
    || fullName.split("/").some((part) => part === "." || part === "..")) throw new Error("GitHub security source is invalid.");
  const { appId, privateKey } = config(options.env);
  const fetcher = options.fetch ?? fetch;
  const appToken = createGitHubAppJwt(appId, privateKey);
  const issued = await createInstallationToken(installationId, appToken, {
    repository_ids: [repositoryId], permissions: SECURITY_READ_PERMISSIONS,
  }, fetcher);
  if (!Array.isArray(issued.repositories) || !issued.repositories.some((item) =>
    typeof item === "object" && item !== null && (item as Record<string, unknown>).id === repositoryId)
    || !hasReadOnlyPermissions(issued.permissions, SECURITY_READ_PERMISSIONS)) {
    await revokeInstallationToken(issued.token, fetcher).catch(() => undefined);
    throw new Error("GitHub security token is not restricted to the selected repository and read-only alerts.");
  }
  const token = issued.token;
  const [owner, repo] = fullName.split("/");
  const prefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const clip = (value: unknown, max = 4000) => typeof value === "string" ? value.slice(0, max) : "";
  const object = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  try {
    const items: GitHubSnapshotItem[] = [];
    let truncated = false;
    for (let page = 1; page <= 8; page++) {
      const alerts = await githubJson<unknown>(`${prefix}/dependabot/alerts?state=open,dismissed,fixed,auto_dismissed&per_page=25&page=${page}`,
        token, "GET", undefined, fetcher);
      if (!Array.isArray(alerts)) throw new Error("GitHub Dependabot response is invalid.");
      for (const value of alerts) {
        const alert = object(value);
        if (!positiveId(alert.number)) continue;
        const dependency = object(alert.dependency);
        const packageInfo = object(dependency.package);
        const advisory = object(alert.security_advisory);
        const vulnerability = object(alert.security_vulnerability);
        const vulnerablePackage = object(vulnerability.package);
        const vulnerable = Object.keys(vulnerablePackage).length ? vulnerablePackage : packageInfo;
        const severity = clip(vulnerability.severity ?? advisory.severity, 32).toLowerCase();
        const updatedAt = clip(alert.updated_at, 40) || clip(alert.created_at, 40) || String(alert.number);
        const cvss = object(advisory.cvss);
        const cwes = Array.isArray(advisory.cwes) ? advisory.cwes.slice(0, 20).flatMap((item) => {
          const cwe = object(item);
          return typeof cwe.cwe_id === "string" ? [cwe.cwe_id.slice(0, 32)] : [];
        }) : [];
        const details = {
          alertNumber: alert.number, state: clip(alert.state, 32), severity,
          ecosystem: clip(vulnerable.ecosystem, 40), packageName: clip(vulnerable.name, 256),
          manifestPath: clip(dependency.manifest_path, 1000), scope: clip(dependency.scope, 40),
          relationship: clip(dependency.relationship, 40), ghsaId: clip(advisory.ghsa_id, 32),
          cveId: clip(advisory.cve_id, 32), vulnerableVersionRange: clip(vulnerability.vulnerable_version_range, 500),
          firstPatchedVersion: clip(object(vulnerability.first_patched_version).identifier, 200),
          cvssScore: typeof cvss.score === "number" && Number.isFinite(cvss.score) ? cvss.score : null,
          cwes, createdAt: clip(alert.created_at, 40), dismissedAt: clip(alert.dismissed_at, 40), fixedAt: clip(alert.fixed_at, 40),
        };
        const summary = clip(advisory.summary, 1000) || `${details.packageName} ${severity} dependency alert`.trim();
        items.push({
          kind: "security_finding", sourceId: `github:security:${repositoryId}:${alert.number}`,
          sourceVersion: updatedAt, title: summary, body: clip(advisory.description),
          url: `https://github.com/${fullName}/security/dependabot/${alert.number}`,
          updatedAt, path: details.manifestPath, author: "", details,
        });
      }
      if (alerts.length < 25) break;
      if (page === 8) truncated = true;
    }
    return { items, truncated };
  } finally {
    await revokeInstallationToken(token, fetcher).catch(() => undefined);
  }
}

export async function readGitHubRepositorySnapshot(
  installationId: number,
  repositoryId: number,
  fullName: string,
  options: {
    env?: Record<string, string | undefined>; fetch?: GitHubFetch;
    since?: string | null; previousCommitSha?: string | null;
  } = {},
) {
  if (!positiveId(installationId) || !positiveId(repositoryId)
    || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(fullName)) throw new Error("GitHub repository selection is invalid.");
  const since = typeof options.since === "string" && Number.isFinite(Date.parse(options.since)) ? options.since : null;
  const previousCommitSha = typeof options.previousCommitSha === "string" && /^[a-f0-9]{40}$/i.test(options.previousCommitSha)
    ? options.previousCommitSha : null;
  const { appId, privateKey } = config(options.env);
  const fetcher = options.fetch ?? fetch;
  const appToken = createGitHubAppJwt(appId, privateKey);
  const issued = await createInstallationToken(installationId, appToken, {
    repository_ids: [repositoryId], permissions: PERMISSIONS,
  }, fetcher);
  if (!Array.isArray(issued.repositories) || !issued.repositories.some((repository) =>
    typeof repository === "object" && repository !== null && (repository as Record<string, unknown>).id === repositoryId)
    || !hasReadOnlyPermissions(issued.permissions, PERMISSIONS)) {
    await revokeInstallationToken(issued.token, fetcher).catch(() => undefined);
    throw new Error("GitHub token is not restricted to the selected repository and read-only permissions.");
  }
  const token = issued.token;
  const [owner, repo] = fullName.split("/");
  const prefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const partialErrors: string[] = [];
  const items: GitHubSnapshotItem[] = [];
  let resolvedHeadSha: string | null = null;
  const clip = (value: unknown, max = 4000) => typeof value === "string" ? value.slice(0, max) : "";
  const githubUrl = (value: unknown) => {
    if (typeof value !== "string") return "";
    try { const url = new URL(value); return url.origin === "https://github.com" ? url.href : ""; }
    catch { return ""; }
  };
  const pages = async (path: string) => {
    const result: Record<string, unknown>[] = [];
    for (let page = 1; page <= 2; page++) {
      const data = await githubJson<unknown>(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`, token, "GET", undefined, fetcher);
      if (!Array.isArray(data)) throw new Error("GitHub list response is invalid.");
      result.push(...data.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null));
      if (data.length < 100) return result;
    }
    partialErrors.push("A GitHub record list exceeded the 200-item import limit.");
    return result;
  };
  try {
    const repository = await githubJson<{ id?: unknown; full_name?: unknown; default_branch?: unknown }>(prefix, token, "GET", undefined, fetcher);
    if (repository.id !== repositoryId || typeof repository.full_name !== "string" || repository.full_name.toLowerCase() !== fullName.toLowerCase()) {
      throw new Error("GitHub repository identity does not match the selected repository.");
    }
    const sinceParam = since ? `&since=${encodeURIComponent(since)}` : "";
    const sections = await Promise.allSettled([
      pages(`${prefix}/commits${since ? `?since=${encodeURIComponent(since)}` : ""}`),
      pages(`${prefix}/issues?state=all${sinceParam}`),
      pages(`${prefix}/pulls?state=all&sort=updated&direction=desc`),
    ]);
    const commitRows = sections[0].status === "fulfilled" ? sections[0].value : (partialErrors.push("Commits could not be imported."), []);
    const issueRows = sections[1].status === "fulfilled" ? sections[1].value : (partialErrors.push("Issues could not be imported."), []);
    const sinceMs = since ? Date.parse(since) : null;
    const allPullRows = sections[2].status === "fulfilled" ? sections[2].value : (partialErrors.push("Pull requests could not be imported."), []);
    const pullRows = sinceMs === null ? allPullRows : allPullRows.filter((item) => {
      const updatedMs = Date.parse(typeof item.updated_at === "string" ? item.updated_at : "");
      return !Number.isFinite(updatedMs) || updatedMs >= sinceMs;
    });
    for (const item of commitRows) {
      const sha = typeof item.sha === "string" ? item.sha : "";
      if (!/^[a-f0-9]{40}$/i.test(sha)) continue;
      const commit = typeof item.commit === "object" && item.commit !== null ? item.commit as Record<string, unknown> : {};
      const author = typeof commit.author === "object" && commit.author !== null ? commit.author as Record<string, unknown> : {};
      items.push({ kind: "commit", sourceId: `github:commit:${repositoryId}:${sha}`, sourceVersion: sha,
        title: clip(commit.message).split("\n", 1)[0], body: clip(commit.message), url: githubUrl(item.html_url),
        updatedAt: clip(author.date, 40), path: "", author: clip(author.name, 200) });
    }
    for (const item of issueRows) {
      if (item.pull_request || !positiveId(item.id)) continue;
      items.push({ kind: "issue", sourceId: `github:issue:${repositoryId}:${item.id}`, sourceVersion: clip(item.updated_at, 40) || clip(item.created_at, 40),
        title: clip(item.title, 1000), body: clip(item.body), url: githubUrl(item.html_url), updatedAt: clip(item.updated_at, 40),
        path: "", author: clip((item.user as Record<string, unknown> | undefined)?.login, 200) });
    }
    for (const item of pullRows) {
      if (!positiveId(item.id)) continue;
      const sourceVersion = clip(item.updated_at, 40) || clip(item.created_at, 40);
      const pullRequest: GitHubSnapshotItem = { kind: "pull_request", sourceId: `github:pull:${repositoryId}:${item.id}`, sourceVersion,
        title: clip(item.title, 1000), body: clip(item.body), url: githubUrl(item.html_url), updatedAt: clip(item.updated_at, 40),
        path: "", author: clip((item.user as Record<string, unknown> | undefined)?.login, 200) };
      items.push(pullRequest);
    }
    const pullRequestsWithFiles = pullRows.filter((item) => positiveId(item.number)).slice(0, 10);
    let pullRequestFilesUnavailable = false;
    const pullFileResults = await Promise.allSettled(pullRequestsWithFiles.map(async (item) => {
      const files = await githubJson<unknown>(`${prefix}/pulls/${item.number}/files?per_page=50`, token, "GET", undefined, fetcher);
      if (!Array.isArray(files)) throw new Error("GitHub pull request file list is invalid.");
      const validFiles = files.flatMap((file) => {
        if (typeof file !== "object" || file === null) return [];
        const row = file as Record<string, unknown>;
        return typeof row.filename === "string" && row.filename.length > 0 && row.filename.length <= 400
          && typeof row.sha === "string" && /^[a-f0-9]{40}$/i.test(row.sha)
          ? [{ path: row.filename, sha: row.sha, status: typeof row.status === "string" ? row.status.slice(0, 30) : "unknown" }]
          : [];
      });
      const changedFiles = validFiles.slice(0, 20);
      let changedFilesTruncated = validFiles.length > changedFiles.length || validFiles.length !== files.length;
      while (changedFiles.length && Buffer.byteLength(JSON.stringify({ changedFiles, changedFilesTruncated })) > 10_000) {
        changedFiles.pop();
        changedFilesTruncated = true;
      }
      return { id: item.id as number, sourceVersion: clip(item.updated_at, 40) || clip(item.created_at, 40), changedFiles, changedFilesTruncated };
    }));
    for (const result of pullFileResults) {
      if (result.status === "rejected") { pullRequestFilesUnavailable = true; continue; }
      const pullRequest = items.find((entry) => entry.kind === "pull_request" && entry.sourceId === `github:pull:${repositoryId}:${result.value.id}`);
      if (!pullRequest) continue;
      pullRequest.details = { changedFiles: result.value.changedFiles, changedFilesTruncated: result.value.changedFilesTruncated,
        filesSourceVersion: result.value.sourceVersion };
      if (result.value.changedFilesTruncated) partialErrors.push("A pull request changed-file list was truncated or contained unsupported file metadata.");
    }
    if (pullRequestFilesUnavailable) partialErrors.push("Some pull request changed-file metadata could not be imported.");
    if (pullRows.length > pullRequestsWithFiles.length) partialErrors.push("Only the first 10 returned pull requests include changed-file metadata.");
    const branch = typeof repository.default_branch === "string" ? repository.default_branch : "";
    if (branch) {
      try {
        const ref = await githubJson<{ object?: { sha?: unknown } }>(`${prefix}/git/ref/heads/${encodeURIComponent(branch)}`, token, "GET", undefined, fetcher);
        const sha = ref.object?.sha;
        if (typeof sha !== "string" || !/^[a-f0-9]{40}$/i.test(sha)) throw new Error("GitHub branch reference is invalid.");
        try {
          const checks = await githubJson<{ total_count?: unknown; check_runs?: unknown }>(`${prefix}/commits/${sha}/check-runs?per_page=100`, token, "GET", undefined, fetcher);
          const runs = Array.isArray(checks.check_runs) ? checks.check_runs : [];
          if (typeof checks.total_count === "number" && checks.total_count > 100) partialErrors.push("The default-branch head has more than 100 check runs; only the first 100 were imported.");
          for (const value of runs.slice(0, 100)) {
            if (typeof value !== "object" || value === null) continue;
            const run = value as Record<string, unknown>;
            if (!positiveId(run.id) || typeof run.name !== "string" || run.head_sha !== sha) continue;
            const app = typeof run.app === "object" && run.app !== null ? run.app as Record<string, unknown> : {};
            const updatedAt = clip(run.completed_at, 40) || clip(run.started_at, 40) || clip(run.created_at, 40);
            const conclusion = typeof run.conclusion === "string" ? run.conclusion : "pending";
            const url = githubUrl(run.html_url);
            if (!url) continue;
            items.push({ kind: "check_run", sourceId: `github:check_run:${repositoryId}:${run.id}`,
              sourceVersion: `${updatedAt}:${String(run.status ?? "unknown")}:${conclusion}`,
              title: clip(run.name, 1000), body: clip(run.output && typeof run.output === "object" ? (run.output as Record<string, unknown>).title : ""),
              url, updatedAt, path: "", author: clip(app.name, 200),
              details: { headSha: sha, status: clip(run.status, 40), conclusion,
                summary: clip(run.output && typeof run.output === "object" ? (run.output as Record<string, unknown>).summary : "", 3000) } });
          }
        } catch { partialErrors.push("Default-branch check runs could not be imported."); }
        resolvedHeadSha = sha;
        const pushFile = (filePath: unknown, fileSha: unknown) => {
          if (typeof filePath !== "string" || typeof fileSha !== "string" || !filePath || !fileSha) return;
          const path = filePath.split("/").map(encodeURIComponent).join("/");
          items.push({ kind: "file", sourceId: `github:file:${repositoryId}:${filePath}`, sourceVersion: fileSha,
            title: filePath.split("/").at(-1) ?? filePath, body: "", url: `https://github.com/${fullName}/blob/${sha}/${path}`,
            updatedAt: "", path: filePath.slice(0, 1000), author: "" });
        };
        const fullTreeWalk = async () => {
          const tree = await githubJson<{ truncated?: unknown; tree?: unknown }>(`${prefix}/git/trees/${sha}?recursive=1`, token, "GET", undefined, fetcher);
          if (!Array.isArray(tree.tree)) throw new Error("GitHub tree response is invalid.");
          const files = tree.tree.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && entry.type === "blob");
          if (tree.truncated === true || files.length > 500) partialErrors.push("The repository file tree exceeded the 500-file import limit.");
          for (const file of files.slice(0, 500)) pushFile(file.path, file.sha);
        };
        if (previousCommitSha === sha) {
          // Default-branch head is unchanged since the last sync; no file metadata changed.
        } else if (previousCommitSha) {
          try {
            const comparison = await githubJson<{ files?: unknown; status?: unknown }>(
              `${prefix}/compare/${previousCommitSha}...${sha}`, token, "GET", undefined, fetcher);
            if (!Array.isArray(comparison.files)) throw new Error("GitHub compare response is invalid.");
            const changedFiles = comparison.files.filter((entry): entry is Record<string, unknown> =>
              typeof entry === "object" && entry !== null && entry.status !== "removed");
            if (changedFiles.length > 300) partialErrors.push("The incremental file diff exceeded the 300-file compare limit.");
            for (const file of changedFiles.slice(0, 300)) pushFile(file.filename, file.sha);
          } catch {
            partialErrors.push("Incremental file diff failed (likely a force-push or rebased history); imported the full file tree instead.");
            await fullTreeWalk();
          }
        } else {
          await fullTreeWalk();
        }
      } catch { partialErrors.push("The default-branch file tree could not be imported."); }
    } else partialErrors.push("The repository has no default branch; file metadata was skipped.");
    try {
      const security = await readGitHubDependabotAlerts(installationId, repositoryId, fullName, { env: options.env, fetch: fetcher });
      items.push(...security.items);
      if (security.truncated) partialErrors.push("Dependabot alerts exceeded the 200-alert import limit.");
    } catch {
      partialErrors.push("Dependabot alerts were not imported; check the App's Dependabot alerts read permission and repository setting.");
    }
    return { repositoryId, fullName: repository.full_name, items, partialErrors, headCommitSha: resolvedHeadSha, incremental: since !== null || previousCommitSha !== null };
  } finally {
    await revokeInstallationToken(token, fetcher).catch(() => undefined);
  }
}

export async function createGitHubProposalPullRequest(input: {
  installationId: number; repositoryId: number; fullName: string; proposalId: string; proposalHash: string;
  title: string; patch: string; baseRef: string; baseSha: string; createdAt: string; rationale: string; risk: string;
}, options: { env?: Record<string, string | undefined>; fetch?: GitHubFetch } = {}) {
  if (!positiveId(input.installationId) || !positiveId(input.repositoryId)
    || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(input.fullName)
    || !/^[0-9a-f-]{36}$/i.test(input.proposalId) || !/^[a-f0-9]{64}$/.test(input.proposalHash)
    || !/^[a-f0-9]{40}$/i.test(input.baseSha) || !input.baseRef || input.baseRef.length > 255
    || !input.title.trim() || input.title.length > 200 || !Number.isFinite(Date.parse(input.createdAt))) {
    throw new Error("GitHub proposal target is invalid.");
  }
  const paths = unifiedPatchPaths(input.patch);
  const { appId, privateKey } = config(options.env);
  const fetcher = options.fetch ?? fetch;
  const appToken = createGitHubAppJwt(appId, privateKey);
  const [owner, repo] = input.fullName.split("/");
  const prefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const issued = await createInstallationToken(input.installationId, appToken, {
    repository_ids: [input.repositoryId], permissions: ACTION_PERMISSIONS,
  }, fetcher);
  if (!Array.isArray(issued.repositories) || !issued.repositories.some((item) =>
    typeof item === "object" && item !== null && (item as Record<string, unknown>).id === input.repositoryId)
    || !hasReadOnlyPermissions(issued.permissions, ACTION_PERMISSIONS)) {
    await revokeInstallationToken(issued.token, fetcher).catch(() => undefined);
    throw new Error("GitHub action token is not restricted to the selected repository and approved permissions.");
  }
  const token = issued.token;
  const api = <T>(path: string, method = "GET", body?: unknown) => githubJson<T>(`${prefix}${path}`, token, method, body, fetcher);
  const refPath = (ref: string) => `/git/ref/heads/${ref.split("/").map(encodeURIComponent).join("/")}`;
  try {
    const commit = await api<{ tree?: { sha?: unknown } }>(`/git/commits/${input.baseSha}`);
    const baseTree = commit.tree?.sha;
    if (typeof baseTree !== "string" || !/^[a-f0-9]{40}$/i.test(baseTree)) throw new Error("GitHub base commit tree is invalid.");
    const tree = await api<{ truncated?: unknown; tree?: unknown }>(`/git/trees/${baseTree}?recursive=1`);
    if (tree.truncated === true || !Array.isArray(tree.tree)) throw new Error("GitHub base tree is unavailable or truncated.");
    const treeEntries = tree.tree.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
    const sourceFiles = new Map<string, { content: string; mode: "100644" | "100755" }>();
    for (const path of paths) {
      const item = treeEntries.find((candidate) => candidate.path === path);
      if (!item) continue;
      if (item.type !== "blob" || (item.mode !== "100644" && item.mode !== "100755")
        || typeof item.sha !== "string" || !/^[a-f0-9]{40}$/i.test(item.sha)) {
        throw new Error("Patch target is not a regular text file.");
      }
      const blob = await api<{ size?: unknown; encoding?: unknown; content?: unknown }>(`/git/blobs/${item.sha}`);
      if (typeof blob.size !== "number" || blob.size > 1_000_000 || blob.encoding !== "base64" || typeof blob.content !== "string") {
        throw new Error("Patch target exceeds the text-file limit or has an unsupported encoding.");
      }
      const encoded = blob.content.replace(/\s/g, "");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("GitHub returned an invalid file blob.");
      const bytes = Buffer.from(encoded, "base64");
      const content = bytes.toString("utf8");
      if (bytes.length !== blob.size || bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")
        || !Buffer.from(content, "utf8").equals(bytes) || content.includes("\0")) {
        throw new Error("Patch target is not valid UTF-8 text.");
      }
      sourceFiles.set(path, { content, mode: item.mode });
    }
    const changes = applyUnifiedPatch(input.patch, sourceFiles);
    const entries = [];
    for (const change of changes) {
      let sha: string | null = null;
      if (!change.deleted) {
        const blob = await api<{ sha?: unknown }>("/git/blobs", "POST", { content: change.content, encoding: "utf-8" });
        if (typeof blob.sha !== "string" || !/^[a-f0-9]{40}$/i.test(blob.sha)) throw new Error("GitHub did not create the proposed file blob.");
        sha = blob.sha;
      }
      entries.push({ path: change.path, mode: change.mode, type: "blob", sha });
    }
    const nextTree = await api<{ sha?: unknown }>("/git/trees", "POST", { base_tree: baseTree, tree: entries });
    if (typeof nextTree.sha !== "string" || !/^[a-f0-9]{40}$/i.test(nextTree.sha)) throw new Error("GitHub did not create the proposed tree.");
    const timestamp = new Date(input.createdAt).toISOString();
    const nextCommit = await api<{ sha?: unknown }>("/git/commits", "POST", {
      message: `Waypoint reviewed proposal ${input.proposalId}`,
      tree: nextTree.sha, parents: [input.baseSha],
      author: { name: "Waypoint", email: "waypoint-bot@users.noreply.github.com", date: timestamp },
      committer: { name: "Waypoint", email: "waypoint-bot@users.noreply.github.com", date: timestamp },
    });
    if (typeof nextCommit.sha !== "string" || !/^[a-f0-9]{40}$/i.test(nextCommit.sha)) throw new Error("GitHub did not create the proposed commit.");
    const branch = `waypoint/proposal-${input.proposalId}`;
    let branchExists = false;
    try {
      const existing = await api<{ object?: { sha?: unknown } }>(refPath(branch));
      branchExists = true;
      if (existing.object?.sha !== nextCommit.sha) throw new Error("The deterministic proposal branch contains unexpected changes.");
    } catch (error) {
      if (!String(error).includes("GitHub request failed (404)")) throw error;
    }
    if (!branchExists) {
      const base = await api<{ object?: { sha?: unknown } }>(refPath(input.baseRef));
      if (base.object?.sha !== input.baseSha) throw new Error("The reviewed base branch changed; create a fresh proposal.");
      try { await api("/git/refs", "POST", { ref: `refs/heads/${branch}`, sha: nextCommit.sha }); }
      catch (error) {
        if (!String(error).includes("GitHub request failed (422)")) throw error;
        const created = await api<{ object?: { sha?: unknown } }>(refPath(branch));
        if (created.object?.sha !== nextCommit.sha) throw new Error("A conflicting proposal branch already exists.");
      }
    }
    const query = () => api<Array<{ number?: unknown; state?: unknown; draft?: unknown; title?: unknown; html_url?: unknown; head?: { ref?: unknown; sha?: unknown }; base?: { ref?: unknown } }>>(
      `/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&base=${encodeURIComponent(input.baseRef)}&per_page=100`,
    );
    const verifyPull = (pull: { number?: unknown; state?: unknown; draft?: unknown; title?: unknown; html_url?: unknown; head?: { ref?: unknown; sha?: unknown }; base?: { ref?: unknown } }) => {
      if (!positiveId(pull.number) || pull.state !== "open" || pull.head?.ref !== branch || pull.head.sha !== nextCommit.sha
        || pull.base?.ref !== input.baseRef || typeof pull.html_url !== "string" || new URL(pull.html_url).origin !== "https://github.com") {
        throw new Error("GitHub pull request did not match the reviewed proposal.");
      }
      return { number: pull.number, url: pull.html_url, title: typeof pull.title === "string" ? pull.title : input.title, draft: pull.draft === true };
    };
    const found = await query();
    if (!Array.isArray(found) || found.length > 1) throw new Error("GitHub returned ambiguous proposal pull requests.");
    let pull = found[0];
    if (!pull) {
      try {
        pull = await api("/pulls", "POST", {
          title: input.title, head: branch, base: input.baseRef, draft: true,
          body: `Created from reviewed Waypoint proposal ${input.proposalId}.\n\nRationale: ${input.rationale}\n\nRisk: ${input.risk}\n\nProposal SHA-256: ${input.proposalHash}`,
        }) as typeof pull;
      } catch (error) {
        const concurrent = await query().catch(() => []);
        if (!Array.isArray(concurrent) || concurrent.length !== 1) throw error;
        pull = concurrent[0];
      }
    }
    if (!positiveId(pull?.number)) throw new Error("GitHub pull request response is invalid.");
    const observed = await api<typeof pull>(`/pulls/${pull.number}`);
    const result = verifyPull(observed);
    let checks: "success" | "failure" | "pending" | "none" | "unavailable" = "unavailable";
    try {
      const [runs, statuses] = await Promise.all([
        api<{ total_count?: unknown; check_runs?: unknown }>(`/commits/${nextCommit.sha}/check-runs?per_page=100`),
        api<{ state?: unknown; total_count?: unknown; statuses?: unknown }>(`/commits/${nextCommit.sha}/status`),
      ]);
      const checkRuns = Array.isArray(runs.check_runs) ? runs.check_runs as Record<string, unknown>[] : [];
      const statusRows = Array.isArray(statuses.statuses) ? statuses.statuses as Record<string, unknown>[] : [];
      const failed = ["failure", "error"].includes(String(statuses.state))
        || checkRuns.some((item) => item.status === "completed" && !["success", "neutral", "skipped"].includes(String(item.conclusion)))
        || statusRows.some((item) => ["failure", "error"].includes(String(item.state)));
      const pending = checkRuns.some((item) => item.status !== "completed") || statuses.state === "pending";
      const truncated = (typeof runs.total_count === "number" && runs.total_count > checkRuns.length)
        || (typeof statuses.total_count === "number" && statuses.total_count > statusRows.length);
      checks = failed ? "failure" : pending ? "pending" : truncated ? "unavailable" : checkRuns.length + statusRows.length ? "success" : "none";
    } catch { /* Missing read permission leaves the verified pull request result intact. */ }
    return { ...result, commitSha: nextCommit.sha, checks };
  } finally {
    await revokeInstallationToken(token, fetcher).catch(() => undefined);
  }
}

export async function authorizeGitHubInstallation(
  code: string,
  installationId: number,
  options: { env?: Record<string, string | undefined>; fetch?: GitHubFetch } = {},
) {
  if (!code || code.length > 512 || !positiveId(installationId)) throw new Error("GitHub authorization response is invalid.");
  const env = options.env ?? process.env;
  const clientId = env.GITHUB_APP_CLIENT_ID;
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GitHub OAuth credentials are not configured.");
  const fetcher = options.fetch ?? fetch;
  const response = await fetcher("https://github.com/login/oauth/access_token", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "Waypoint" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const size = Number(response.headers.get("content-length") ?? 0);
  if (size > 64_000) throw new Error("GitHub OAuth response exceeds the size limit.");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 64_000) throw new Error("GitHub OAuth response exceeds the size limit.");
  if (!response.ok) throw new Error(`GitHub OAuth failed (${response.status}).`);
  let auth: unknown;
  try { auth = JSON.parse(text); } catch { throw new Error("GitHub OAuth response is invalid."); }
  if (typeof auth !== "object" || auth === null || typeof (auth as Record<string, unknown>).access_token !== "string") {
    throw new Error("GitHub OAuth did not issue a user token.");
  }
  const userToken = (auth as Record<string, string>).access_token;
  try {
    const user = await githubJson<{ id?: unknown; login?: unknown }>("/user", userToken, "GET", undefined, fetcher);
    if (!positiveId(user.id) || typeof user.login !== "string") throw new Error("GitHub user identity is invalid.");
    for (let page = 1; page <= 20; page++) {
      const result = await githubJson<{ total_count?: unknown; installations?: unknown }>(`/user/installations?per_page=100&page=${page}`, userToken, "GET", undefined, fetcher);
      if (!Array.isArray(result.installations)) throw new Error("GitHub installation list is invalid.");
      if (result.installations.some((item) => typeof item === "object" && item !== null && (item as Record<string, unknown>).id === installationId)) {
        return { installationId, githubUserId: user.id, githubLogin: user.login };
      }
      if (result.installations.length < 100) break;
    }
    throw new Error("GitHub installation is not authorized for the signed-in GitHub user.");
  } finally {
    const revoke = await fetcher(`${API}/applications/${encodeURIComponent(clientId)}/token`, {
      method: "DELETE", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "x-github-api-version": API_VERSION,
        "user-agent": "Waypoint",
        "content-type": "application/json",
      },
      body: JSON.stringify({ access_token: userToken }),
    }).catch(() => null);
    if (revoke && !revoke.ok && revoke.status !== 404) throw new Error("GitHub user token could not be revoked.");
  }
}

import type { GitHubSnapshotItem } from "@/lib/github-app";

export type GitHubSourceForImport = {
  workspaceId: string;
  sourceId: string;
  repositoryId: number;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  providerUpdatedAt: string | null;
};

type GitHubImportRecord = {
  record_id: string;
  record_type: string;
  provider_version: string;
  source_url: string;
  title: string;
  body: string;
  path: string;
  author: string;
  updated_at: string | null;
  details?: Record<string, unknown>;
  captured_at: string;
  repository_id: number;
  repository_name: string;
  repository_url: string;
  default_branch: string;
};

export function toGitHubImportRecords(source: GitHubSourceForImport, items: GitHubSnapshotItem[], capturedAt: string) {
  const repositoryKey = `github:repo:${source.repositoryId}`;
  const records: GitHubImportRecord[] = [{
    record_id: repositoryKey, record_type: "repository",
    provider_version: source.providerUpdatedAt ?? `default:${source.defaultBranch || "unknown"}`, source_url: source.htmlUrl,
    title: source.fullName, body: "", path: "", author: "", updated_at: source.providerUpdatedAt,
    captured_at: capturedAt, repository_id: source.repositoryId, repository_name: source.fullName,
    repository_url: source.htmlUrl, default_branch: source.defaultBranch,
  }];
  for (const item of items.filter((item) => item.kind !== "security_finding")) records.push({
    record_id: item.sourceId, record_type: item.kind, provider_version: item.sourceVersion,
    source_url: item.url || source.htmlUrl, title: item.title, body: item.body, path: item.path, author: item.author,
    updated_at: item.updatedAt || null, ...(item.details ? { details: item.details } : {}),
    captured_at: capturedAt, repository_id: source.repositoryId, repository_name: source.fullName,
    repository_url: source.htmlUrl, default_branch: source.defaultBranch,
  });
  return records;
}

export function toGitHubSecurityImportRecords(source: GitHubSourceForImport, items: GitHubSnapshotItem[], capturedAt: string) {
  return items.filter((item) => item.kind === "security_finding").map((item) => ({
    record_id: item.sourceId, record_type: item.kind, provider_version: item.sourceVersion,
    source_url: item.url, title: item.title, body: item.body, path: item.path, author: item.author,
    updated_at: item.updatedAt || null, details: item.details ?? {}, captured_at: capturedAt,
    repository_id: source.repositoryId, repository_name: source.fullName,
    repository_url: source.htmlUrl, default_branch: source.defaultBranch,
  }));
}

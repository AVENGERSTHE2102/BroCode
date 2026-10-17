// Scope of an agent run: the whole workspace, only the synthetic sample, or one GitHub repository.
// Enforced server-side inside every graph query — the model never chooses or sees a way around it.
export type GraphScope = "all" | "sample" | `github:repo:${number}`;

const REPO_SCOPE = /^github:repo:(\d{1,20})$/;

export function parseScope(value: unknown): GraphScope {
  if (value === "sample") return "sample";
  return typeof value === "string" && REPO_SCOPE.test(value) ? (value as GraphScope) : "all";
}

/**
 * Cypher predicate restricting `entity` to the scope, plus the parameters it needs.
 * People are cross-repository by nature and stay allowed, but any path through a person that reaches another
 * repository's records is rejected because every node on a path is checked.
 */
export function scopeCondition(entity: string, scope: GraphScope) {
  if (scope === "all") return { clause: "true", params: {} as Record<string, string> };
  if (scope === "sample") return { clause: `${entity}.source_id STARTS WITH 'sample:'`, params: {} as Record<string, string> };
  const id = REPO_SCOPE.exec(scope)![1];
  return {
    clause: `(${entity}:Person OR ${entity}.source_id = $scope_repo OR ${entity}.source_id CONTAINS $scope_mid)`,
    params: { scope_repo: scope as string, scope_mid: `:${id}:` } as Record<string, string>,
  };
}

/** JS twin of scopeCondition for post-filtering results (e.g. FalkorDB shortestPath, which can't be pre-filtered per node). */
export function nodeInScope(node: { labels?: unknown; source_id?: unknown }, scope: GraphScope) {
  if (scope === "all") return true;
  const sourceId = typeof node.source_id === "string" ? node.source_id : "";
  if (scope === "sample") return sourceId.startsWith("sample:");
  if (Array.isArray(node.labels) && node.labels.includes("Person")) return true;
  return sourceId === scope || sourceId.includes(`:${REPO_SCOPE.exec(scope)![1]}:`);
}

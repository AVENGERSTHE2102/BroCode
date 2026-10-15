export type GraphDisplayNode = { id: string; label: string; title: string; sourceId?: string; version?: string; url?: string };
export type GraphDisplayPath = { nodes: GraphDisplayNode[]; relationships: string[] };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function githubUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.origin === "https://github.com" && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

function jsonArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || value.length > 16_000) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function decodeGraphPathRows(rows: unknown[][]): unknown[][] {
  return rows.slice(0, 50).flatMap((row) => {
    const nodes = jsonArray(row[0]);
    const relationships = jsonArray(row[1]);
    return nodes.length >= 2 && relationships.length === nodes.length - 1 ? [[nodes, relationships]] : [];
  });
}

export function graphPathsForDisplay(value: unknown): GraphDisplayPath[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((row): GraphDisplayPath[] => {
    if (!Array.isArray(row) || !Array.isArray(row[0]) || !Array.isArray(row[1])) return [];
    const nodes = row[0].slice(0, 5).flatMap((item): GraphDisplayNode[] => {
      if (!record(item)) return [];
      const labels = Array.isArray(item.labels) ? item.labels : [];
      const label = labels.find((part) => typeof part === "string");
      const rawId = item.source_id ?? item.id;
      if (typeof rawId !== "string" && typeof rawId !== "number") return [];
      const title = [item.title, item.name, item.path].find((part) => typeof part === "string" && part.trim());
      const url = githubUrl(item.source_url);
      return [{
        id: String(rawId).slice(0, 300), label: typeof label === "string" ? label.slice(0, 64) : "Entity",
        title: typeof title === "string" ? title.slice(0, 200) : String(rawId).slice(0, 200),
        ...(typeof item.source_id === "string" ? { sourceId: item.source_id.slice(0, 300) } : {}),
        ...(typeof item.source_version === "string" ? { version: item.source_version.slice(0, 200) } : {}),
        ...(url ? { url } : {}),
      }];
    });
    if (nodes.length < 2) return [];
    const relationships = row[1].slice(0, 4).map((edge) => record(edge) && typeof edge.type === "string" ? edge.type.slice(0, 64) : "RELATED_TO");
    return [{ nodes, relationships }];
  });
}

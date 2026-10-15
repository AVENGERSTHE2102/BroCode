export type EvalRecord = { id: string; kind: "node" | "edge"; sourceId: string; version: string; text: string };
export type EvalCase = {
  id: string;
  question: string;
  principalRole?: string;
  principalGroups?: string[];
  nodes: Array<Record<string, unknown> & { id: string }>;
  edges: Array<Record<string, unknown> & { id: string; from: string; to: string }>;
  expected: { claims: string[]; evidencePaths: string[][] };
};

function visible(record: Record<string, unknown>, testCase: EvalCase) {
  const groups = record.aclGroups;
  if (Array.isArray(groups) && !groups.some((group) => typeof group === "string" && testCase.principalGroups?.includes(group))) return false;
  const role = record.aclRole;
  return role === undefined || role === "workspace" || role === testCase.principalRole;
}

function recordText(record: Record<string, unknown>, kind: "node" | "edge") {
  const values = Object.entries(record).filter(([key, value]) => !["aclGroups", "aclRole"].includes(key) && value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
  return `${kind.toUpperCase()} ${values.join("; ")}`;
}

export function visibleEvalRecords(testCase: EvalCase): EvalRecord[] {
  const nodes = testCase.nodes.filter((node) => visible(node, testCase));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const records: EvalRecord[] = nodes.map((node) => ({
    id: node.id, kind: "node", sourceId: `${testCase.id}:node:${node.id}`,
    version: typeof node.sourceVersion === "string" ? node.sourceVersion : `${testCase.id}:fixture-v1`,
    text: recordText(node, "node"),
  }));
  for (const edge of testCase.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to) || !visible(edge, testCase)) continue;
    records.push({
      id: edge.id, kind: "edge", sourceId: `${testCase.id}:edge:${edge.id}`,
      version: typeof edge.sourceVersion === "string" ? edge.sourceVersion : `${testCase.id}:fixture-v1`,
      text: recordText(edge, "edge"),
    });
  }
  return records;
}

function terms(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export function retrieveEvalText(records: EvalRecord[], query: string, limit = 12) {
  const queryTerms = [...new Set(terms(query))];
  const tokenized: string[][] = records.map((record) => terms(record.text));
  const documentFrequency = new Map(queryTerms.map((term) => [term, tokenized.filter((doc) => doc.includes(term)).length]));
  return records.map((record, index) => {
    const doc = tokenized[index];
    const lengthNorm = 0.5 + 0.5 * doc.length / Math.max(1, tokenized.reduce((sum, item) => sum + item.length, 0) / Math.max(1, records.length));
    const score = queryTerms.reduce((sum, term) => {
      const frequency = doc.filter((item) => item === term).length;
      if (!frequency) return sum;
      const df = documentFrequency.get(term) ?? 0;
      const inverseFrequency = Math.log(1 + (records.length - df + 0.5) / (df + 0.5));
      return sum + inverseFrequency * frequency * 2.2 / (frequency + 1.2 * lengthNorm);
    }, 0);
    return { record, score, index };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, Math.min(50, limit))).map(({ record }) => record);
}

export function markdownEvalMemory(records: EvalRecord[]) {
  return records.map((record) => `- ${record.text} [source ${record.sourceId} @ ${record.version}]`).join("\n");
}

export function collectEvalEvidence(value: unknown) {
  const records = new Set<string>();
  const refs = new Map<string, { sourceId: string; version: string }>();
  const visit = (item: unknown, depth: number) => {
    if (depth > 12 || item === null || typeof item !== "object") return;
    if (Array.isArray(item)) { item.forEach((child) => visit(child, depth + 1)); return; }
    const record = item as Record<string, unknown>;
    if (record.ambiguous === true || record.resolved === false) return;
    if (typeof record.id === "string") records.add(record.id);
    if (typeof record.sourceId === "string" && typeof record.version === "string") {
      refs.set(`${record.sourceId}\u0000${record.version}`, { sourceId: record.sourceId, version: record.version });
    }
    Object.values(record).forEach((child) => visit(child, depth + 1));
  };
  visit(value, 0);
  return { records, refs };
}

export function expectedPathCoverage(paths: string[][], seenRecords: Set<string>) {
  if (!paths.length) return 1;
  return paths.filter((path) => path.every((id) => seenRecords.has(id))).length / paths.length;
}

export function lexicalClaimScores(expected: string[], actual: string[]) {
  if (!expected.length) return { recall: actual.length ? 0 : 1, f1: actual.length ? 0 : 1 };
  const expectedTerms = expected.map((claim) => new Set(terms(claim)));
  const actualTerms = new Set(terms(actual.join(" ")));
  const recalls = expectedTerms.map((set) => [...set].filter((term) => actualTerms.has(term)).length / Math.max(1, set.size));
  const expectedSet = new Set(expectedTerms.flatMap((set) => [...set]));
  const truePositives = [...actualTerms].filter((term) => expectedSet.has(term)).length;
  const precision = truePositives / Math.max(1, actualTerms.size);
  const recall = recalls.reduce((sum, value) => sum + value, 0) / recalls.length;
  return { recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0 };
}

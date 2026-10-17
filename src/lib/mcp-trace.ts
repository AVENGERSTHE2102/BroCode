function byteLength(value: unknown) {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Infinity; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectEvidenceIds(value: unknown) {
  const ids = new Set<string>();
  let visited = 0;
  const visit = (item: unknown, depth: number) => {
    if (visited++ >= 500 || depth > 8) return;
    if (Array.isArray(item)) { for (const child of item) visit(child, depth + 1); return; }
    if (!isRecord(item)) return;
    if (item.ambiguous === true || item.resolved === false) return;
    for (const key of ["id", "source_id", "sourceId"]) {
      const id = item[key];
      if ((typeof id === "string" || typeof id === "number") && String(id).length <= 300) ids.add(String(id));
    }
    for (const child of Object.values(item)) visit(child, depth + 1);
  };
  visit(value, 0);
  return [...ids].slice(0, 100);
}

export function buildMcpTracePayload(args: Record<string, unknown>, value: unknown, toolName: string) {
  let input: unknown = args;
  let output: unknown = value;
  const resultValue = isRecord(value) && value.ok === true && isRecord(value.value) ? value.value : value;
  let graphPaths = ["trace_entity", "find_experts", "impact_analysis", "shortest_path"].includes(toolName) && isRecord(resultValue) && Array.isArray(resultValue.data) ? resultValue.data : [];
  let truncated = false;
  if (toolName === "remember_fact") {
    input = {
      investigationId: args.investigationId, factKey: args.factKey, expectedVersion: args.expectedVersion,
      provenance: args.provenance, idempotencyKey: args.idempotencyKey, candidateContentQuarantined: true,
    };
  }
  if (byteLength(input) > 12_000) {
    input = { fields: Object.keys(args), investigationId: args.investigationId, idempotencyKey: args.idempotencyKey, truncated: true };
    truncated = true;
  }
  if (byteLength(output) > 14_000) {
    output = { truncated: true, originalBytes: byteLength(value) };
    truncated = true;
  }
  if (byteLength(graphPaths) > 8_000) {
    graphPaths = graphPaths.slice(0, 3);
    truncated = true;
  }
  const evidenceIds = collectEvidenceIds(value);
  const payload = { input, output, graphPaths, evidenceIds };
  if (byteLength(payload) > 38_000) return { input: { toolName, investigationId: args.investigationId, truncated: true }, output: { truncated: true }, graphPaths: [], evidenceIds, truncated: true };
  return { ...payload, truncated };
}

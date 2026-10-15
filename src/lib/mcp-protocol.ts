export const MCP_MODERN_VERSION = "2026-07-28";
export const MCP_LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];

type RpcRequest = { method?: unknown; params?: unknown };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function validateMcpProtocolRequest(request: Request, message: RpcRequest) {
  const params = isRecord(message.params) ? message.params : {};
  const meta = isRecord(params._meta) ? params._meta : {};
  const envelopeVersion = meta["io.modelcontextprotocol/protocolVersion"];
  const versionHeader = request.headers.get("mcp-protocol-version");
  const methodHeader = request.headers.get("mcp-method");
  const nameHeader = request.headers.get("mcp-name");
  const modern = envelopeVersion === MCP_MODERN_VERSION;

  if (envelopeVersion !== undefined && !modern) return { ok: false as const, code: -32022, message: "Unsupported MCP protocol version.", supported: [MCP_MODERN_VERSION] };
  if (versionHeader === MCP_MODERN_VERSION && !modern) return { ok: false as const, code: -32020, message: "MCP protocol-version header does not match the request envelope." };
  if (!modern) return { ok: true as const, modern: false as const };

  const expectedName = (message.method === "tools/call" || message.method === "prompts/get") && isRecord(params) ? params.name : undefined;
  if (versionHeader !== MCP_MODERN_VERSION || methodHeader !== message.method
    || (typeof expectedName === "string" ? nameHeader !== expectedName : nameHeader !== null)) {
    return { ok: false as const, code: -32020, message: "MCP routing headers do not match the request body." };
  }
  return { ok: true as const, modern: true as const };
}

export function mcpModernResult(value: Record<string, unknown>, cacheable = false) {
  return {
    ...value,
    resultType: "complete",
    ...(cacheable ? { ttlMs: 0, cacheScope: "private" } : {}),
    _meta: { "io.modelcontextprotocol/serverInfo": { name: "waypoint", version: "0.1.0" } },
  };
}

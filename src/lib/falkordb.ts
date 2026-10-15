import { createClient } from "redis";

export type GraphRow = unknown[];
export type GraphParams = Record<string, string | number | boolean | null>;
export type GraphQuery = <T extends GraphRow = GraphRow>(query: string, timeoutMs?: number, params?: GraphParams) => Promise<T[]>;

export async function withWorkspaceGraph<T>(graphName: string, work: (query: GraphQuery) => Promise<T>): Promise<T> {
  const configuredUrl = process.env.FALKORDB_URL;

  if (!configuredUrl) throw new Error("FALKORDB_URL is not configured");
  const url = new URL(configuredUrl);
  if (url.protocol !== "falkors:" && url.protocol !== "falkor:") {
    throw new Error("FALKORDB_URL must use falkors:// (TLS, e.g. FalkorDB Cloud) or falkor:// (plain, e.g. local Docker)");
  }
  url.protocol = url.protocol === "falkors:" ? "rediss:" : "redis:";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(graphName)) throw new Error("Graph name is invalid");

  const client = createClient({ url: url.toString(), RESP: 2, socket: { connectTimeout: 5000, reconnectStrategy: false } });
  client.on("error", () => {});
  await client.connect();
  try {
    return await work(async <Row extends GraphRow>(query: string, timeoutMs = 3000, params: GraphParams = {}) => {
      const bindings = Object.entries(params).map(([key, value]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || (typeof value === "number" && !Number.isFinite(value))) {
          throw new Error("Graph query parameter is invalid");
        }
        return `${key}=${typeof value === "string" ? JSON.stringify(value) : String(value)}`;
      });
      const parameterizedQuery = bindings.length ? `CYPHER ${bindings.join(" ")} ${query}` : query;
      const result = await client.sendCommand(["GRAPH.QUERY", graphName, parameterizedQuery, "TIMEOUT", String(timeoutMs)]);
      if (!Array.isArray(result) || !Array.isArray(result[1])) return [];
      return result[1] as Row[];
    });
  } finally {
    await client.quit();
  }
}

import { createClient } from "redis";

export type GraphRow = unknown[];
export type GraphQuery = <T extends GraphRow = GraphRow>(query: string, timeoutMs?: number) => Promise<T[]>;

export async function withWorkspaceGraph<T>(work: (query: GraphQuery) => Promise<T>): Promise<T> {
  const configuredUrl = process.env.FALKORDB_URL;
  const graphName = process.env.FALKORDB_GRAPH ?? "waypoint_demo";

  if (!configuredUrl) throw new Error("FALKORDB_URL is not configured");
  const url = new URL(configuredUrl);
  if (url.protocol === "falkor:") url.protocol = "redis:";
  else if (url.protocol === "falkors:") url.protocol = "rediss:";
  else throw new Error("FALKORDB_URL must use falkor:// or falkors://");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(graphName)) throw new Error("FALKORDB_GRAPH has an invalid name");

  const client = createClient({ url: url.toString(), socket: { connectTimeout: 5000, reconnectStrategy: false } });
  client.on("error", () => {});
  await client.connect();
  try {
    return await work(async <Row extends GraphRow>(query: string, timeoutMs = 3000) => {
      const result = await client.sendCommand(["GRAPH.QUERY", graphName, query, "TIMEOUT", String(timeoutMs)]);
      if (!Array.isArray(result) || !Array.isArray(result[1])) return [];
      return result[1] as Row[];
    });
  } finally {
    await client.quit();
  }
}

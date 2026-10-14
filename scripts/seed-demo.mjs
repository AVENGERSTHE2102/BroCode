import { createClient } from "redis";

const url = process.env.FALKORDB_URL;
const graphName = process.env.FALKORDB_GRAPH ?? "waypoint_demo";
if (!url || !/^falkors?:\/\//i.test(url)) throw new Error("Set FALKORDB_URL to your FalkorDB Cloud connection URL.");
if (!/^[A-Za-z0-9_-]{1,64}$/.test(graphName)) throw new Error("FALKORDB_GRAPH has an invalid name.");

const connectionUrl = new URL(url);
if (connectionUrl.protocol === "falkor:") connectionUrl.protocol = "redis:";
else if (connectionUrl.protocol === "falkors:") connectionUrl.protocol = "rediss:";
else throw new Error("FALKORDB_URL must use falkor:// or falkors://");
const client = createClient({ url: connectionUrl.toString(), socket: { connectTimeout: 5000, reconnectStrategy: false } });
client.on("error", () => {});
await client.connect();
const query = async (cypher) => {
  const reply = await client.sendCommand(["GRAPH.QUERY", graphName, cypher, "TIMEOUT", "3000"]);
  return Array.isArray(reply) && Array.isArray(reply[1]) ? reply[1] : [];
};
try {
  await query(
    `MERGE (service:Service {id: "checkout"}) SET service.title = "Checkout service", service.kind = "Service", service.source = "service-catalog.json", service.summary = "Maya Kim owns the checkout service."
     MERGE (deploy:Deployment {id: "deploy-1842"}) SET deploy.title = "Checkout service · deploy #1842", deploy.kind = "Deployment", deploy.source = "deployments.json", deploy.summary = "Checkout deploy #1842 changed retry handling."
     MERGE (incident:Incident {id: "INC-284"}) SET incident.title = "Payment failures after checkout deploy", incident.kind = "Incident", incident.source = "INC-284.md", incident.summary = "Payment failures and retry volume rose after deploy #1842."
     MERGE (decision:Decision {id: "decision-retry"}) SET decision.title = "Retry policy decision", decision.kind = "Decision", decision.source = "decisions.md", decision.summary = "The retry policy recommends rollback when the service error rate crosses its threshold."
     MERGE (previous:Deployment {id: "deploy-1837"}) SET previous.title = "Rollback to deploy #1837 was attempted", previous.kind = "Deployment", previous.source = "INC-284.md", previous.summary = "A rollback to deploy #1837 was attempted; retry rate stayed high, and the prior configuration was restored."
     MERGE (owner:Person {id: "maya-kim"}) SET owner.title = "Maya Kim", owner.kind = "Person", owner.source = "team-directory.json", owner.summary = "Maya Kim is listed as checkout owner."
     MERGE (service)-[:HAS_DEPLOYMENT]->(deploy)
     MERGE (deploy)-[:TRIGGERED]->(incident)
     MERGE (incident)-[:INFORMED_BY]->(decision)
     MERGE (incident)-[:HAS_PREVIOUS_ATTEMPT]->(previous)
     MERGE (service)-[:OWNED_BY]->(owner)`,
  );

  const verification = await query("MATCH (n) WHERE n.id IN [\"checkout\", \"deploy-1842\", \"INC-284\", \"decision-retry\", \"deploy-1837\", \"maya-kim\"] RETURN count(n) AS nodes");
  const count = Number(verification[0]?.[0]);
  if (count !== 6) throw new Error(`Seed verification failed: expected 6 demo nodes, found ${count}.`);
  console.log(`Seeded ${count} synthetic nodes in FalkorDB graph ${graphName}.`);
} finally {
  await client.quit();
}

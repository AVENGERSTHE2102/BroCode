import { lookup, resolve4 } from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import nextEnv from "@next/env";
import { createClient } from "redis";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const fail = (stage, error) => {
  const code = error?.code || "UNKNOWN";
  console.error(`${stage}: FAIL (${code})`);
  process.exitCode = 1;
};

const addressTest = async (hostname, port) => new Promise((resolve, reject) => {
  const socket = net.createConnection({ host: hostname, port });
  socket.setTimeout(5000);
  socket.once("connect", () => { socket.destroy(); resolve(); });
  socket.once("timeout", () => socket.destroy(Object.assign(new Error(), { code: "ETIMEDOUT" })));
  socket.once("error", reject);
});

const tlsTest = async (hostname, port) => new Promise((resolve, reject) => {
  const socket = tls.connect({ host: hostname, port, servername: hostname, rejectUnauthorized: true });
  socket.setTimeout(5000);
  socket.once("secureConnect", () => {
    if (!socket.authorized) return socket.destroy(Object.assign(new Error(), { code: "CERT_REJECTED" }));
    const details = { version: socket.getProtocol(), authorized: socket.authorized };
    socket.end();
    resolve(details);
  });
  socket.once("timeout", () => socket.destroy(Object.assign(new Error(), { code: "ETIMEDOUT" })));
  socket.once("error", reject);
});

const configuredUrl = process.env.FALKORDB_URL;
if (!configuredUrl) {
  console.error("Configuration: FAIL (FALKORDB_URL is not set in the Next.js environment files)");
  process.exit(1);
}

let endpoint;
try {
  endpoint = new URL(configuredUrl);
  if (endpoint.protocol !== "falkors:") throw Object.assign(new Error(), { code: "INVALID_PROTOCOL" });
  if (!endpoint.hostname || !endpoint.port) throw Object.assign(new Error(), { code: "INVALID_ENDPOINT" });
} catch (error) {
  fail("Configuration", error);
  process.exit(1);
}

const hostname = endpoint.hostname;
const port = Number(endpoint.port);
console.log(`Runtime: platform=${process.platform} node=${process.version}`);
console.log(`Endpoint: protocol=falkors: hostname=${hostname} port=${port}`);

try {
  const result = await lookup(hostname);
  console.log(`dns.lookup: PASS (${result.address})`);
} catch (error) {
  fail("dns.lookup", error);
  try { await addressTest("13.127.238.58", 63495); console.log("Diagnostic TCP to known Mac-resolved IP: PASS (13.127.238.58:63495; hostname config unchanged)"); }
  catch (tcpError) { fail("Diagnostic TCP to known Mac-resolved IP", tcpError); }
  console.log("TLS/authentication/PING: NOT RUN (hostname DNS failed; TLS hostname validation was not bypassed)");
  process.exit(1);
}

try {
  const addresses = await resolve4(hostname);
  console.log(`dns.resolve4: PASS (${addresses.join(", ")})`);
} catch (error) { fail("dns.resolve4", error); }

try { await addressTest(hostname, port); console.log("TCP: PASS"); }
catch (error) { fail("TCP", error); process.exit(1); }

try {
  const result = await tlsTest(hostname, port);
  console.log(`TLS: PASS (certificate verified, ${result.version})`);
} catch (error) { fail("TLS", error); process.exit(1); }

const redisUrl = new URL(endpoint);
redisUrl.protocol = "rediss:";
const client = createClient({ url: redisUrl.toString(), socket: { connectTimeout: 5000, reconnectStrategy: false } });
client.on("error", () => {});
try {
  await client.connect();
  console.log("Redis authentication: PASS");
} catch (error) {
  const message = String(error?.message || "");
  if (/NOAUTH|WRONGPASS|invalid username-password|authentication/i.test(message)) fail("Redis authentication", Object.assign(new Error(), { code: "AUTH_FAILED" }));
  else fail("Redis connection", error);
  process.exit(1);
}
try {
  const result = await client.ping();
  if (result !== "PONG") throw Object.assign(new Error(), { code: "UNEXPECTED_PING_RESPONSE" });
  console.log("Redis PING: PASS (PONG)");
} catch (error) {
  fail("Redis PING", error);
} finally {
  if (client.isOpen) await client.quit().catch(() => {});
}

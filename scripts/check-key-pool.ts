import assert from "node:assert/strict";
import { KeyPool, parseApiKeys } from "../src/lib/key-pool";
import { completeWithModel, readModelConfig } from "../src/lib/agent-runner";

// Pool mechanics with a fake clock.
let time = 0;
const pool = new KeyPool(["k1", "k2", "k3", "k2"], () => time);
assert.equal(pool.size, 3, "duplicate keys collapse");
assert.deepEqual([pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire()].map((lease) => ("key" in lease ? lease.key : null)), ["k1", "k2", "k3", "k1"], "round-robin rolling");
pool.cooldown("k2", 5000); pool.invalidate("k3");
assert.deepEqual([(pool.acquire() as { key: string }).key, (pool.acquire() as { key: string }).key], ["k1", "k1"], "cooling and invalid keys are skipped");
pool.cooldown("k1", 9000);
assert.deepEqual(pool.acquire(), { waitMs: 5000 }, "reports the soonest recovery");
time = 5000;
assert.equal((pool.acquire() as { key: string }).key, "k2", "key returns after cooldown");
pool.invalidate("k1"); pool.invalidate("k2");
assert.deepEqual(pool.acquire(), { waitMs: Infinity });
assert.ok(pool.status().every((entry) => !entry.key.includes("k1") || entry.key.startsWith("#")), "status is redacted");
assert.deepEqual(parseApiKeys({ AI_API_KEY: "a", AI_API_KEYS: "b, c\nd,a" }), ["a", "b", "c", "d"]);

// Rolling through the provider: 429 on key A moves to key B without failing the call; 401 retires a key.
const config = readModelConfig({ AI_BASE_URL: "https://models.example/v1", AI_API_KEYS: "keyA-1111,keyB-2222,keyC-3333", AI_MODEL: "m" })!;
assert.equal(config.apiKeys?.length, 3);
const used: string[] = [];
const original = globalThis.fetch;
globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
  const key = String((init.headers as Record<string, string>).authorization).replace("Bearer ", "");
  used.push(key);
  if (key === "keyA-1111") return new Response("{}", { status: 429, headers: { "retry-after": "60" } });
  if (key === "keyB-2222") return new Response("{}", { status: 401 });
  return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
}) as typeof fetch;
try {
  const result = await completeWithModel([], [], config);
  assert.equal(result.choices?.[0]?.message?.content, "ok");
  assert.deepEqual(used, ["keyA-1111", "keyB-2222", "keyC-3333"], "rolled A (rate limited) → B (rejected) → C");
  used.length = 0;
  await completeWithModel([], [], config);
  assert.deepEqual(used, ["keyC-3333"], "A is cooling and B retired, so later calls go straight to C");
} finally { globalThis.fetch = original; }
console.log("Key pool rolls across API keys, cools rate-limited keys, retires rejected keys, and redacts status.");

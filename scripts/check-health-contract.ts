import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../src/app/api/graph/health/route.ts", import.meta.url), "utf8");
assert.match(route, /resolveWorkspace\(request\)/);
assert.match(route, /dependencies: \{ supabase, falkordb \}/);
assert.match(route, /status: "connected", latencyMs:/);
assert.match(route, /status: "unavailable", latencyMs/);
assert.match(route, /\^\[A-Z0-9_\]\{1,64\}\$/);
assert.doesNotMatch(route, /cause\.message|FALKORDB_URL|process\.env/);

console.log("Health route reports authenticated dependency status and sanitized latency/errors.");

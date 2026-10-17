import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GET, runtime } from "../src/app/api/health/live/route";

assert.equal(runtime, "nodejs");
const response = await GET();
assert.equal(response.status, 200);
assert.equal(response.headers.get("cache-control"), "no-store");
assert.deepEqual(await response.json(), { status: "ok" });
const middleware = await readFile(new URL("../src/middleware.ts", import.meta.url), "utf8");
assert.match(middleware, /api\/health\/live\|/);

console.log("Liveness check is dependency-free and returns no deployment or secret details.");

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { readJsonBody } from "../src/lib/read-json-body";

const encoder = new TextEncoder();
const request = (chunks: string[], headers?: HeadersInit) => new Request("https://waypoint.test/api", {
  method: "POST", headers, body: new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); },
  }),
});

assert.deepEqual(await readJsonBody(request(['{"answer":"ok"}']), 32), { ok: true, value: { answer: "ok" } });
assert.deepEqual(await readJsonBody(request(["{} "]), 3), { ok: true, value: {} });
assert.deepEqual(await readJsonBody(request(["{}  "]), 3), { ok: false, reason: "too_large" });
assert.deepEqual(await readJsonBody(request(['"💜"']), 5), { ok: false, reason: "too_large" });
assert.deepEqual(await readJsonBody(request(["{" ]), 32), { ok: false, reason: "invalid" });
const invalidUtf8 = new Request("https://waypoint.test/api", { method: "POST", body: new Uint8Array([34, 255, 34]) });
assert.deepEqual(await readJsonBody(invalidUtf8, 32), { ok: false, reason: "invalid" });

let cancelled = false;
const streamed = new Request("https://waypoint.test/api", {
  method: "POST", body: new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode("1234")); },
    cancel() { cancelled = true; },
  }),
});
assert.deepEqual(await readJsonBody(streamed, 3), { ok: false, reason: "too_large" });
assert.equal(cancelled, true);

const declared = request(["{}"], { "content-length": "10" });
assert.deepEqual(await readJsonBody(declared, 3), { ok: false, reason: "too_large" });

async function apiRoutes(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const full = `${path}/${entry.name}`;
    if (entry.isDirectory()) return apiRoutes(full);
    return entry.name === "route.ts" ? [full] : [];
  }))).flat();
}
for (const path of await apiRoutes("src/app/api")) {
  assert.doesNotMatch(await readFile(path, "utf8"), /request\.(?:json|text)\(\)/, `${path} must use the bounded JSON body reader`);
}
console.log("JSON request bodies enforce byte limits for declared and streaming lengths.");

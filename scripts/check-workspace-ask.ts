import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [panel, home, route] = await Promise.all([
  readFile(new URL("../src/app/workspace-ask-panel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/ask/route.ts", import.meta.url), "utf8"),
]);

assert.match(home, /<WorkspaceAskPanel\s*\/>/);
assert.match(panel, /fetch\("\/api\/investigations"/);
assert.match(panel, /setInvestigation\(created\)/);
assert.match(panel, /fetch\("\/api\/ask"/);
assert.match(panel, /investigationId: created\.id/);
assert.match(panel, /workflowDomain/);
assert.match(panel, /Choose workflow/);
assert.match(route, /import \{ POST as runInvestigation \}/);
assert.match(route, /requestedWrites: \{ proposals: false, factCandidates: false, taskUpdates: false \}/);
assert.match(route, /\["authorization", "x-waypoint-workspace", "origin"\]/);
assert.match(route, /runInvestigation\(runRequest/);
assert.match(panel, /if \(!runResponse\.ok\) throw/);
assert.match(panel, /href=\{`\/investigations\/\$\{investigation\.id\}`\}/);
assert.match(panel, /result\.citations\.map/);
assert.match(panel, /target="_blank" rel="noreferrer"/);
console.log("Workspace Ask creates a durable, read-only investigation and exposes its evidence link.");

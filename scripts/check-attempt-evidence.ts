import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/202610150017_attempt_evidence_source_validation.sql", import.meta.url), "utf8");
const service = await readFile(new URL("../src/lib/attempts.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../src/app/api/investigations/[id]/attempts/route.ts", import.meta.url), "utf8");
const agentTools = await readFile(new URL("../src/lib/agent-tools.ts", import.meta.url), "utf8");

assert.match(migration, /before insert or update of workspace_id, retry_explanation, changed_conditions on public\.investigation_attempts/i);
assert.match(migration, /public\.workspace_source_version_accessible\(/);
assert.doesNotMatch(migration, /workspace_github_records|workspace_github_record_versions/);
assert.match(migration, /using errcode = '23514'/i);
assert.match(service, /error\?\.code === "23514"[\s\S]*Changed-condition evidence does not match an available workspace source version/);
assert.match(route, /recordInvestigationAttempt\(request, id, parsed\.value\)/);
assert.match(agentTools, /recordInvestigationAttempt\(request, investigationId, attempt\)/);

console.log("Retry changed-condition evidence is checked at the database boundary for REST and MCP callers.");

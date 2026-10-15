import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/202610150007_investigation_forgetting.sql", "utf8");
const factCandidates = readFileSync("supabase/migrations/202610150015_fact_candidate_quarantine.sql", "utf8");
const worker = readFileSync("src/lib/graph-projection-worker.ts", "utf8");
const route = readFileSync("src/app/api/investigations/[id]/forget/route.ts", "utf8");
const runRoute = readFileSync("src/app/api/investigations/[id]/run/route.ts", "utf8");
const detail = readFileSync("src/app/investigation-detail.tsx", "utf8");

assert.match(migration, /m\.role in \('owner', 'admin'\)/);
assert.match(migration, /delete from public\.investigations/);
assert.match(factCandidates, /foreign key \(workspace_id, investigation_id\)[\s\S]*references public\.investigations\(workspace_id, id\) on delete cascade/i);
assert.match(migration, /set status = 'stale'[\s\S]*status in \('proposed', 'approved'\)/);
assert.match(migration, /o\.investigation_id = r\.investigation_id[\s\S]*o\.processed_at is null/);
assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/);
assert.match(migration, /delete from public\.graph_projection_outbox o[\s\S]*set status = 'complete'/);
assert.match(worker, /n\.id = \$id OR n\.investigation_id = \$id/);
assert.match(worker, /r\.id IN \$\{idList\}/);
assert.match(worker, /if \(graphClear\)[\s\S]*complete_investigation_forget/);
assert.match(route, /current\.workspace\.role !== "owner" && current\.workspace\.role !== "admin"/);
assert.match(detail, /window\.confirm\([\s\S]*setForgetRequestId/);
assert.match(runRoute, /const assertInvestigationLive = async/);
assert.match(runRoute, /completeWithModel\(messages, tools, config, request\.signal\)/);
assert.match(runRoute, /const result = await invokeMcpTool[\s\S]*await assertInvestigationLive\(\);\s*return result/);
assert.match(runRoute, /if \(error instanceof InvestigationDeletedError\)[\s\S]*status: 410/);
assert.match(detail, /agentController\.current\?\.abort\(\)/);
assert.match(detail, /signal: controller\.signal/);
console.log("Forgetting authorization, cascade, projection barrier, graph verification, and explicit confirmation are wired.");

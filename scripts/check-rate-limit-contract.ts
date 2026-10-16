import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/202610160003_workspace_rate_limits.sql", import.meta.url), "utf8");
assert.match(migration, /create table public\.workspace_rate_limits/i);
assert.match(migration, /alter table public\.workspace_rate_limits enable row level security/i);
assert.match(migration, /revoke all on public\.workspace_rate_limits from public, anon, authenticated, service_role/i);
assert.match(migration, /create function public\.check_workspace_rate_limit/i);
assert.match(migration, /security definer/i);
assert.match(migration, /set search_path = ''/i);
assert.match(migration, /auth\.uid\(\) is null then raise exception 'authenticated user required'/i);
assert.match(migration, /workspace_memberships m[\s\S]*m\.user_id = auth\.uid\(\)/i);
assert.match(migration, /grant execute on function public\.check_workspace_rate_limit\(uuid, text, integer, integer\) to authenticated/i);
assert.doesNotMatch(migration, /grant [^;]*check_workspace_rate_limit[^;]*to anon/i);

const runRoute = await readFile(new URL("../src/app/api/investigations/[id]/run/route.ts", import.meta.url), "utf8");
assert.match(runRoute, /check_workspace_rate_limit/);
assert.match(runRoute, /p_bucket: "agent_run"/);
assert.match(runRoute, /status: 429/);

const syncRoute = await readFile(new URL("../src/app/api/sources/github/[sourceId]/sync/route.ts", import.meta.url), "utf8");
assert.match(syncRoute, /check_workspace_rate_limit/);
assert.match(syncRoute, /p_bucket: "github_sync"/);
assert.match(syncRoute, /status: 429/);

// /api/ask delegates into the run route's own POST handler, so its own file must not
// need a separate rate-limit call — guard against that assumption silently breaking.
const askRoute = await readFile(new URL("../src/app/api/ask/route.ts", import.meta.url), "utf8");
assert.match(askRoute, /runInvestigation\(runRequest/);

console.log("Workspace rate limiting is wired into the agent-run, ask-delegation, and GitHub-sync routes with a membership-checked, SECURITY DEFINER-isolated RPC.");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [service, detail, taskRoute, memberRoute, memberMigration] = await Promise.all([
  readFile(new URL("../src/lib/tasks.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/investigation-detail.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/investigations/[id]/tasks/[taskId]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/workspace-members/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202610150014_workspace_member_directory.sql", import.meta.url), "utf8"),
]);

assert.match(service, /\.eq\("workspace_id", current\.workspace\.id\)\.eq\("investigation_id", investigationId\)/);
assert.match(service, /\.eq\("to_user_id", current\.workspace\.userId\)\.eq\("status", "pending"\)/);
assert.match(service, /\.in\("task_id", tasks\.map\(\(task\) => task\.id\)\)/);
assert.match(detail, /getJson\(`\$\{root\}\/tasks`\)/);
assert.match(detail, /"claim" \| "complete" \| "acknowledge_handoff"/);
assert.match(detail, /taskOperationKey \|\| crypto\.randomUUID\(\)/);
assert.match(detail, /setTaskOperationKey\(idempotencyKey\)/);
assert.match(detail, /Pending handoff from/);
assert.match(detail, /Accept handoff/);
assert.match(taskRoute, /acknowledgeTaskHandoff/);
assert.match(memberMigration, /auth\.uid\(\)[\s\S]*workspace_memberships[\s\S]*p_workspace_id/);
assert.match(memberMigration, /returns table\(user_id uuid, role text\)/);
assert.doesNotMatch(memberMigration, /email/i);
assert.match(memberRoute, /Cache-Control.*private, no-store/);
assert.match(detail, /Request handoff/);
console.log("Investigation task recovery is workspace-scoped and exposes only the signed-in user's pending handoffs.");

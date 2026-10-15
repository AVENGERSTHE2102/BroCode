import assert from "node:assert/strict";
// @ts-expect-error Bun provides this test-only module at runtime; app types use Node declarations.
import { mock } from "bun:test";
import { readFile } from "node:fs/promises";
import { getRequestAccessToken } from "../src/lib/supabase/server";

const malformedAuth = new Request("https://waypoint.example/api/graph/health", { headers: { authorization: "Bearer bad token" } });
assert.deepEqual(getRequestAccessToken(malformedAuth), { ok: false });

const userId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
let failure: "claims" | "membership" | "none" = "none";
let membership: unknown = { data: { workspace_id: workspaceId, role: "owner", workspaces: { name: "Team" } }, error: null };
const filters: Array<[string, string]> = [];
let membershipQueries = 0;
const supabase = {
  auth: { getClaims: async () => {
    if (failure === "claims") throw new Error("secret provider response");
    return { data: { claims: { sub: userId } }, error: null };
  } },
  from: (table: string) => {
    assert.equal(table, "workspace_memberships");
    membershipQueries++;
    const query = {
      select: () => query,
      eq: (key: string, value: string) => { filters.push([key, value]); return query; },
      order: () => query,
      limit: () => query,
      maybeSingle: async () => {
        if (failure === "membership") throw new Error("secret provider response");
        return membership;
      },
    };
    return query;
  },
};
mock.module("@/lib/supabase/server", () => ({ getRequestAccessToken, createClient: async () => supabase }));
const { resolveWorkspace } = await import("../src/lib/workspace");

assert.deepEqual(await resolveWorkspace(malformedAuth), { ok: false, status: 401, error: "A valid bearer token is required." });
const selected = (id: string) => new Request("https://waypoint.example/api/graph/health", {
  headers: { authorization: "Bearer valid.token", "x-waypoint-workspace": id },
});
failure = "claims";
const claimsFailure = await resolveWorkspace(selected(workspaceId));
assert.deepEqual(claimsFailure, { ok: false, status: 503, error: "Workspace authentication could not be checked." });
assert.equal(JSON.stringify(claimsFailure).includes("secret provider response"), false);

failure = "membership";
const membershipFailure = await resolveWorkspace(selected(workspaceId));
assert.deepEqual(membershipFailure, { ok: false, status: 503, error: "Workspace membership could not be checked." });
assert.equal(JSON.stringify(membershipFailure).includes("secret provider response"), false);

failure = "none";
const beforeInvalidWorkspace = membershipQueries;
assert.deepEqual(await resolveWorkspace(selected("not-a-workspace-id")), { ok: false, status: 409, error: "The selected workspace is invalid." });
assert.equal(membershipQueries, beforeInvalidWorkspace);

membership = { data: null, error: null };
filters.length = 0;
assert.deepEqual(await resolveWorkspace(selected("33333333-3333-4333-8333-333333333333")), {
  ok: false, status: 409, error: "Create or select a workspace to continue.",
});
assert.ok(filters.some(([key, value]) => key === "user_id" && value === userId));
assert.ok(filters.some(([key, value]) => key === "workspace_id" && value === "33333333-3333-4333-8333-333333333333"));

membership = { data: { workspace_id: workspaceId, role: "owner", workspaces: { name: "Team" } }, error: null };
filters.length = 0;
assert.deepEqual(await resolveWorkspace(selected(workspaceId)), {
  ok: true, workspace: { id: workspaceId, name: "Team", role: "owner", graphName: "wp_11111111111141118111111111111111", userId },
});
assert.ok(filters.some(([key, value]) => key === "user_id" && value === userId));
assert.ok(filters.some(([key, value]) => key === "workspace_id" && value === workspaceId));

const workspace = await readFile(new URL("../src/lib/workspace.ts", import.meta.url), "utf8");
assert.match(workspace, /try \{[\s\S]*claimsResult = await supabase\.auth\.getClaims\([\s\S]*catch \{[\s\S]*status: 503/);
assert.match(workspace, /maybeSingle\(\)[\s\S]*catch \{[\s\S]*status: 503/);
assert.doesNotMatch(workspace, /cause\.message/);

console.log("Workspace resolution rejects malformed credentials/IDs, scopes membership filters, and sanitizes thrown Supabase errors.");

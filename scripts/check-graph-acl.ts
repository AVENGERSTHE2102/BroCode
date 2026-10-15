import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyGraphMatches, parseResolveInput, parseTraceInput } from "@/lib/graph-tools";

const [tools, projection] = await Promise.all([
  readFile(new URL("../src/lib/graph-tools.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/graph-projection.ts", import.meta.url), "utf8"),
]);
const [aliasMigration, aliasRoute] = await Promise.all([
  readFile(new URL("../supabase/migrations/202610150011_workspace_entity_aliases.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/entity-aliases/route.ts", import.meta.url), "utf8"),
]);

assert.match(tools, /readableAcl\("n"\)/, "entity resolution must use the common role policy");
assert.match(tools, /all\(node IN nodes\(p\) WHERE \$\{readableAcl\("node"\)\}\)/, "trace must check every path node");
assert.match(tools, /all\(edge IN relationships\(p\) WHERE \$\{readableAcl\("edge"\)\}\)/, "trace must check every path relationship");
assert.match(tools, /acl_role = 'admin' AND \$role = 'owner'/, "owners must read admin-scoped findings, matching Postgres RLS");
assert.match(projection, /acl_role = 'workspace'/, "projected workflow records need explicit default visibility");
assert.equal(parseResolveInput(null), null);
assert.equal(parseResolveInput({ identifier: 8 }), null);
assert.deepEqual(parseResolveInput({ identifier: "  svc-1  " }), { identifier: "svc-1" });
assert.equal(parseTraceInput([]), null);
assert.equal(parseTraceInput({ entityId: " " }), null);
assert.deepEqual(parseTraceInput({ entityId: " incident-1 ", maxDepth: 3 }), { entityId: "incident-1", maxDepth: 3 });
assert.match(tools, /normalized_alias/);
assert.match(tools, /ambiguous: true/);
assert.match(aliasRoute, /target identifier is ambiguous/i);
assert.match(aliasRoute, /create_workspace_entity_alias/);
assert.match(aliasMigration, /unique \(workspace_id, normalized_alias\)/i);
assert.doesNotMatch(aliasMigration, /grant [^;]*insert[^;]*workspace_entity_aliases to authenticated/i);
assert.deepEqual(classifyGraphMatches([["Repository", { source_id: "repo:1" }]], "exact"), {
  data: [["Repository", { source_id: "repo:1" }]], resolved: true, resolvedBy: "exact", ambiguous: false, truncated: false,
});
const ambiguous = classifyGraphMatches([["Commit", { source_id: "one" }], ["Commit", { source_id: "two" }]], "alias");
assert.deepEqual(ambiguous.data, []);
assert.equal(ambiguous.ambiguous, true);
assert.equal(ambiguous.resolved, false);
console.log("Graph reads enforce role checks on entities, path nodes, and path relationships.");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { requireSameOrigin } from "../src/lib/same-origin";

// Unit behavior: a matching Origin passes, a cross-site Origin fails, and a missing
// Origin fails closed (strict by design, since these are cookie-session mutations).
assert.equal(requireSameOrigin(new Request("https://waypoint.example/api/investigations", {
  method: "POST", headers: { origin: "https://waypoint.example" },
})), true);
assert.equal(requireSameOrigin(new Request("https://waypoint.example/api/investigations", {
  method: "POST", headers: { origin: "https://attacker.example" },
})), false);
assert.equal(requireSameOrigin(new Request("https://waypoint.example/api/investigations", { method: "POST" })), false);
assert.equal(requireSameOrigin(new Request("https://waypoint.example/api/investigations", {
  method: "POST", headers: { origin: "not a url" },
})), false);

// Every state-changing route must use the shared helper, not a one-off inline check,
// so this stays consistent as new routes are added.
const mutatingRoutes = [
  "../src/app/api/ask/route.ts",
  "../src/app/api/entity-aliases/route.ts",
  "../src/app/api/entity-aliases/[aliasId]/route.ts",
  "../src/app/api/investigations/route.ts",
  "../src/app/api/investigations/[id]/action-proposals/route.ts",
  "../src/app/api/investigations/[id]/action-proposals/[proposalId]/execute/route.ts",
  "../src/app/api/investigations/[id]/action-proposals/[proposalId]/review/route.ts",
  "../src/app/api/investigations/[id]/attempts/route.ts",
  "../src/app/api/investigations/[id]/events/route.ts",
  "../src/app/api/investigations/[id]/facts/route.ts",
  "../src/app/api/investigations/[id]/facts/candidates/[candidateId]/review/route.ts",
  "../src/app/api/investigations/[id]/forget/route.ts",
  "../src/app/api/investigations/[id]/run/route.ts",
  "../src/app/api/investigations/[id]/tasks/route.ts",
  "../src/app/api/investigations/[id]/tasks/[taskId]/route.ts",
  "../src/app/api/sources/github/route.ts",
  "../src/app/api/sources/github/install-url/route.ts",
  "../src/app/api/sources/github/[sourceId]/sync/route.ts",
];
for (const path of mutatingRoutes) {
  const content = await readFile(new URL(path, import.meta.url), "utf8");
  const isAsk = path.endsWith("/ask/route.ts");
  if (isAsk) {
    // /api/ask has no state-changing effect of its own; it forwards into the run route's
    // own POST handler (which does check) and must forward the Origin header to do so.
    assert.match(content, /"origin"/, `${path}: must forward the Origin header to the delegated route`);
  } else {
    assert.match(content, /requireSameOrigin/, `${path}: missing the shared same-origin check`);
    assert.doesNotMatch(content, /headers\.get\("origin"\) !== new URL/, `${path}: has a one-off inline origin check instead of the shared helper`);
  }
}

// /api/mcp intentionally keeps its own, more lenient check (missing Origin is allowed)
// because its primary clients are non-browser Bearer-token callers, not cookie sessions.
const mcpRoute = await readFile(new URL("../src/app/api/mcp/route.ts", import.meta.url), "utf8");
assert.match(mcpRoute, /function validOrigin/);

console.log(`Same-origin checks verified on requireSameOrigin() behavior and ${mutatingRoutes.length} state-changing routes.`);

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runToolSelectionLoop } from "../src/lib/agent-runner";
import { isWorkflowDomain, WORKFLOW_DOMAINS, workflowDomainInstructions, type WorkflowDomain } from "../src/lib/workflow-domains";

const migration = await readFile(new URL("../supabase/migrations/202610150021_investigation_workflow_domains.sql", import.meta.url), "utf8");
const investigations = await readFile(new URL("../src/lib/investigations.ts", import.meta.url), "utf8");
const runRoute = await readFile(new URL("../src/app/api/investigations/[id]/run/route.ts", import.meta.url), "utf8");
const investigationPanel = await readFile(new URL("../src/app/investigations-panel.tsx", import.meta.url), "utf8");
const askPanel = await readFile(new URL("../src/app/workspace-ask-panel.tsx", import.meta.url), "utf8");

for (const domain of WORKFLOW_DOMAINS) {
  let systemPrompt = "";
  await runToolSelectionLoop("What evidence is available?", "investigation-1", [], {
    complete: async (messages) => {
      systemPrompt = String(messages[0]?.content ?? "");
      return { choices: [{ message: { content: JSON.stringify({ abstained: true, claims: [], alternatives: [], uncertainty: "No source evidence." }) } }] };
    },
    invoke: async () => null,
    onToolCall: async () => undefined,
  }, { workflowDomain: domain as WorkflowDomain });
  assert.ok(systemPrompt.includes(workflowDomainInstructions(domain)), `${domain} instructions reach the model`);
}
assert.equal(isWorkflowDomain("fraud_investigation"), true);
assert.equal(isWorkflowDomain("untrusted_domain"), false);
assert.match(workflowDomainInstructions("fraud_investigation"), /risk signals, never proof of intent/i);
assert.match(workflowDomainInstructions("security_triage"), /severity from demonstrated reachability/i);
assert.match(workflowDomainInstructions("codebase_work"), /repository\/ref\/base SHA/i);
assert.match(migration, /workflow_domain text not null default 'general'/i);
for (const domain of WORKFLOW_DOMAINS) assert.ok(migration.includes(`'${domain}'`), `${domain} is database-constrained`);
assert.match(investigations, /workflow_domain: workflowDomain/);
assert.match(investigations, /Workflow domain is invalid/);
assert.match(runRoute, /select\("workflow_domain"\)/);
assert.match(runRoute, /workflowDomain \}/);
assert.match(investigationPanel, /Choose workflow/);
assert.match(askPanel, /Choose workflow/);
assert.match(askPanel, /workflowDomain\s*\}\)/);
assert.match(askPanel, /available evidence depends on connected workspace sources/i);

console.log("Fraud, security, and codebase workflow selections persist and select evidence-specific agent guidance.");

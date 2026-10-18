import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildRecoverySnapshot, MAX_RECOVERY_EXPORT_BYTES, recoverySnapshotMarkdown } from "@/lib/recovery-export";

const detail = await readFile(new URL("../src/app/investigation-detail.tsx", import.meta.url), "utf8");
const snapshot = buildRecoverySnapshot({
  investigation: { title: "Recovery ```case```", status: "active" },
  facts: Array.from({ length: 100 }, (_, index) => ({ fact_key: `fact-${index}`, version: 1, value: "🧭".repeat(300), provenance: "`".repeat(300) })),
  tasks: [
    { id: "open", title: "Continue investigation", status: "open", owner_id: null, details: { note: "bounded" } },
    { id: "closed", title: "Done", status: "completed" },
  ],
  attempts: [{ attempt_key: "retry", attempt_number: 2, outcome: "failed", summary: "Earlier failure", condition_snapshot: { state: "red" } }],
});
assert.ok(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength <= MAX_RECOVERY_EXPORT_BYTES);
assert.ok(new TextEncoder().encode(JSON.stringify(snapshot, null, 2)).byteLength <= MAX_RECOVERY_EXPORT_BYTES);
assert.equal(snapshot.activeTasks.length, 1);
assert.equal(snapshot.activeTasks[0].id, "open");
assert.ok(snapshot.omitted.facts > 0);
assert.equal(snapshot.recentAttempts[0].outcome, "failed");
const markdown = recoverySnapshotMarkdown(snapshot);
assert.ok(new TextEncoder().encode(markdown).byteLength <= MAX_RECOVERY_EXPORT_BYTES);
assert.match(markdown, /# Workspace recovery context/);
assert.match(markdown, /````json/);
assert.match(detail, /Download Markdown/);
assert.match(detail, /Download JSON/);
console.log(`Recovery export stays within ${MAX_RECOVERY_EXPORT_BYTES} bytes and omits closed tasks and overflow records.`);

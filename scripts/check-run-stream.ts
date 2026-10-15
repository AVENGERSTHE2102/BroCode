import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRunTraceStream, type StreamRunEvent } from "../src/lib/run-trace-stream";

const events: StreamRunEvent[] = [
  { id: 11, event_type: "run_started", payload: { runId: "run-1" }, created_at: "2026-10-15T00:00:00Z" },
  { id: 12, event_type: "tool_call", payload: { runId: "run-1", tool: "trace" }, created_at: "2026-10-15T00:00:01Z" },
  { id: 13, event_type: "run_completed", payload: { runId: "run-1" }, created_at: "2026-10-15T00:00:02Z" },
];
const cursors: number[] = [];
const load = async (cursor: number) => {
  cursors.push(cursor);
  return events.filter((event) => event.id > cursor);
};
const response = createRunTraceStream(new Request("https://waypoint.test/events"), load, 10);
assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
assert.equal(response.headers.get("connection"), null);
const stream = await response.text();
assert.match(stream, /id: 11\nevent: run_trace\ndata: .*"event_type":"run_started"/);
assert.match(stream, /id: 12\nevent: run_trace\ndata: .*"tool":"trace"/);
assert.match(stream, /id: 13\nevent: run_trace\ndata: .*"event_type":"run_completed"/);
assert.deepEqual(cursors, [10]);
const resumed = await createRunTraceStream(new Request("https://waypoint.test/events"), load, 11).text();
assert.doesNotMatch(resumed, /id: 11\n/);
assert.match(resumed, /id: 12\nevent: run_trace/);
const deleted = await createRunTraceStream(new Request("https://waypoint.test/events"), async () => null).text();
assert.match(deleted, /event: run_deleted\ndata: \{\}/);

const eventRoute = await readFile(new URL("../src/app/api/investigations/[id]/runs/[runId]/events/route.ts", import.meta.url), "utf8");
const runRoute = await readFile(new URL("../src/app/api/investigations/[id]/run/route.ts", import.meta.url), "utf8");
const detail = await readFile(new URL("../src/app/investigation-detail.tsx", import.meta.url), "utf8");
const askRoute = await readFile(new URL("../src/app/api/ask/route.ts", import.meta.url), "utf8");
const askPanel = await readFile(new URL("../src/app/workspace-ask-panel.tsx", import.meta.url), "utf8");
assert.match(eventRoute, /workspaceSupabase/);
assert.match(eventRoute, /payload->>runId/);
assert.match(eventRoute, /last-event-id/);
assert.match(eventRoute, /polls\+\+ % 5 === 0/);
assert.match(runRoute, /typeof requestedRunId === "string" \? requestedRunId : randomUUID\(\)/);
assert.match(detail, /new EventSource\([\s\S]*runs\/\$\{runId\}\/events/);
assert.match(detail, /requestedWrites, runId/);
assert.match(detail, /addEventListener\("run_deleted"/);
assert.match(askRoute, /\{ runId \}/);
assert.match(askPanel, /new EventSource\([\s\S]*runs\/\$\{runId\}\/events/);
assert.match(askPanel, /idempotencyKey: crypto\.randomUUID\(\), runId/);
assert.match(askPanel, /addEventListener\("run_deleted"/);
console.log("Authenticated run progress streams replay durable events and reconnect by event ID.");

import { runGraphProjectionBatch } from "@/lib/graph-projection-worker";

// Run projection batches in-process until the outbox is empty, another worker holds the lock, or the time budget ends.
// Lets the graph fill right after a sync without a separately scheduled worker process.
export async function drainGraphProjection(budgetMs = 50_000) {
  const deadline = Date.now() + budgetMs;
  let processed = 0, retried = 0, pending = 0, dead = 0, runs = 0, busy = false;
  while (Date.now() < deadline && runs < 25) {
    const result = await runGraphProjectionBatch();
    runs++;
    if (result.status === "busy") { busy = true; break; }
    processed += result.processed; retried += result.retried;
    pending = "pending" in result ? Number(result.pending) : 0;
    dead = "dead" in result ? Number(result.dead) : 0;
    if (!result.processed && !result.retried) break;
  }
  return { processed, retried, pending, dead, busy };
}

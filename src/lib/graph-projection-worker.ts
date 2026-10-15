import { createAdminClient } from "@/lib/supabase/admin";
import { projectGraphEvent, type GraphProjectionEvent } from "@/lib/graph-projection";
import { withWorkspaceGraph, type GraphParams } from "@/lib/falkordb";

const MAX_EVENTS = 20;
const RUN_BUDGET_MS = 38_000;
const WORKER_LEASE_SECONDS = 120;

function safeErrorCode(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
  return typeof code === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(code) ? code : "ProjectionError";
}

export async function runGraphProjectionBatch() {
  const startedAt = Date.now();
  const supabase = createAdminClient();
  const workerId = crypto.randomUUID();
  const lease = await supabase.rpc("lease_graph_projection_worker", {
    p_worker_id: workerId,
    p_lease_seconds: WORKER_LEASE_SECONDS,
  });
  if (lease.error) throw new Error("Projection worker lock is unavailable");
  if (!lease.data) return { status: "busy", workerId, processed: 0, retried: 0, deadLettered: 0, durationMs: Date.now() - startedAt };

  let processed = 0;
  let retried = 0;
  let deadLettered = 0;
  let leaseLost = 0;
  let forgetCompleted = 0;
  const deadline = Date.now() + RUN_BUDGET_MS;

  try {
    while (processed + retried + deadLettered + leaseLost < MAX_EVENTS && Date.now() < deadline) {
      const result = await supabase.rpc("lease_graph_projection_events", {
        p_worker_id: workerId,
        p_limit: 1,
        p_lease_seconds: WORKER_LEASE_SECONDS,
      });
      if (result.error) throw new Error("Projection event lease failed");
      const event = Array.isArray(result.data) ? result.data[0] as GraphProjectionEvent | undefined : undefined;
      if (!event) break;

      try {
        await projectGraphEvent(event);
        const ack = await supabase.rpc("complete_graph_projection_event", { p_event_id: event.id, p_worker_id: workerId });
        if (ack.error) throw new Error("Projection acknowledgement failed");
        if (ack.data) processed++; else leaseLost++;
      } catch (error) {
        const retry = await supabase.rpc("retry_graph_projection_event", {
          p_event_id: event.id,
          p_worker_id: workerId,
          p_error: safeErrorCode(error),
        });
        if (retry.error) throw new Error("Projection retry could not be recorded");
        if (retry.data) {
          if (event.attempts >= 8) deadLettered++;
          else retried++;
        } else {
          leaseLost++;
        }
      }
    }

    const readyForgets = await supabase.rpc("list_ready_investigation_forgets");
    if (readyForgets.error) throw new Error("Forget request queue is unavailable");
    const forget = Array.isArray(readyForgets.data) ? readyForgets.data[0] : null;
    if (forget && typeof forget.workspace_id === "string" && /^[0-9a-f-]{36}$/i.test(forget.workspace_id)
      && typeof forget.investigation_id === "string" && /^[0-9a-f-]{36}$/i.test(forget.investigation_id)
      && Array.isArray(forget.delete_targets)) {
      const targets: { entity_type: string; entity_id: string }[] = forget.delete_targets.flatMap((target: unknown) => {
        if (typeof target !== "object" || target === null) return [];
        const value = target as Record<string, unknown>;
        return typeof value.entity_type === "string" && typeof value.entity_id === "string"
          ? [{ entity_type: value.entity_type, entity_id: value.entity_id }] : [];
      });
      const graphName = `wp_${forget.workspace_id.replaceAll("-", "")}`;
      const graphClear = await withWorkspaceGraph(graphName, async (query) => {
        if ((await query("MATCH (n) WHERE n.id = $id OR n.investigation_id = $id RETURN n.id LIMIT 1", 3000, { id: forget.investigation_id })).length) return false;
        for (let index = 0; index < targets.length; index += 100) {
          const ids = targets.slice(index, index + 100).map((target) => target.entity_id);
          const params: GraphParams = Object.fromEntries(ids.map((id, offset) => [`delete_id_${offset}`, id]));
          const idList = `[${ids.map((_, offset) => `$delete_id_${offset}`).join(",")}]`;
          if ((await query(`MATCH (n) WHERE n.id IN ${idList} RETURN n.id LIMIT 1`, 3000, params)).length) return false;
          if ((await query(`MATCH ()-[r]->() WHERE r.id IN ${idList} RETURN r.id LIMIT 1`, 3000, params)).length) return false;
          await query(`MATCH (m:ProjectionMarker) WHERE m.entity_id IN ${idList} DELETE m`, 3000, params);
        }
        await query("MATCH (p:Person {workspace_id: $workspace_id}) WHERE NOT (p)--() DELETE p", 3000, { workspace_id: forget.workspace_id });
        return true;
      });
      if (graphClear) {
        const completed = await supabase.rpc("complete_investigation_forget", { p_request_id: forget.request_id });
        if (completed.error) throw new Error("Forget completion could not be recorded");
        if (completed.data) forgetCompleted++;
      }
    }

    const health = await supabase.rpc("graph_projection_queue_health");
    if (health.error) throw new Error("Projection queue health is unavailable");
    const metrics = Array.isArray(health.data) ? health.data[0] : null;
    return {
      status: "ok",
      workerId,
      durationMs: Date.now() - startedAt,
      processed,
      retried,
      deadLettered,
      forgetCompleted,
      leaseLost,
      pending: Number(metrics?.pending_count ?? 0),
      dead: Number(metrics?.dead_count ?? 0),
      oldestPendingAt: metrics?.oldest_pending_at ?? null,
    };
  } finally {
    await supabase.rpc("release_graph_projection_worker", { p_worker_id: workerId });
  }
}

import { workspaceSupabase } from "@/lib/workspace-supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_EVENT_TYPES = ["run_started", "tool_call", "run_completed", "run_failed"];

type RunEvent = { id: number; actor_id: string; event_type: string; payload: Record<string, unknown>; created_at: string };

export async function listInvestigationRunTraces(request: Request, investigationId: string) {
  const current = await workspaceSupabase(request);
  if (!current.ok) return current;
  if (!UUID_PATTERN.test(investigationId)) return { ok: false as const, status: 400 as const, error: "Investigation ID is invalid." };
  const { data, error } = await current.supabase.from("investigation_events")
    .select("id, actor_id, event_type, payload, created_at")
    .eq("workspace_id", current.workspace.id).eq("investigation_id", investigationId)
    .in("event_type", RUN_EVENT_TYPES).order("id", { ascending: false }).limit(51);
  if (error) return { ok: false as const, status: 503 as const, error: "Run traces could not be loaded." };

  const groups = new Map<string, RunEvent[]>();
  for (const event of (data ?? []) as RunEvent[]) {
    const runId = event.payload?.runId;
    if (typeof runId !== "string" || !UUID_PATTERN.test(runId)) continue;
    groups.set(runId, [...(groups.get(runId) ?? []), event]);
  }
  const runs = [...groups.entries()].map(([id, descending]) => {
    const events = [...descending].reverse();
    const started = events.find((event) => event.event_type === "run_started");
    const finished = events.findLast((event) => event.event_type === "run_completed" || event.event_type === "run_failed");
    return {
      id,
      model: started?.payload.model ?? null,
      modelRevision: started?.payload.modelRevision ?? null,
      promptRevision: started?.payload.promptRevision ?? null,
      startedAt: started?.created_at ?? events[0]?.created_at ?? null,
      status: finished?.event_type === "run_completed" ? "completed" : finished?.event_type === "run_failed" ? "failed" : "running",
      truncated: events.some((event) => event.payload.truncated === true),
      events,
    };
  }).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return { ok: true as const, data: { runs, truncated: data.length > 50 } };
}

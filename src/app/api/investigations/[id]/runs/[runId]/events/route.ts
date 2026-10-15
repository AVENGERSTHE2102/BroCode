import { createRunTraceStream, type StreamRunEvent } from "@/lib/run-trace-stream";
import { workspaceSupabase } from "@/lib/workspace-supabase";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; runId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPES = ["run_started", "tool_call", "run_completed", "run_failed"];

export async function GET(request: Request, { params }: Context) {
  const access = await workspaceSupabase(request);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  const { id, runId } = await params;
  if (!UUID.test(id) || !UUID.test(runId)) return Response.json({ error: "Investigation or run ID is invalid." }, { status: 400 });
  const investigation = await access.supabase.from("investigations").select("id")
    .eq("workspace_id", access.workspace.id).eq("id", id).maybeSingle();
  if (investigation.error) return Response.json({ error: "Investigation access could not be checked." }, { status: 503 });
  if (!investigation.data) return Response.json({ error: "Investigation was not found." }, { status: 404 });

  const lastEventId = request.headers.get("last-event-id");
  const afterId = lastEventId === null ? 0 : Number(lastEventId);
  if (!Number.isSafeInteger(afterId) || afterId < 0) return Response.json({ error: "Last event ID is invalid." }, { status: 400 });
  let polls = 0;
  return createRunTraceStream(request, async (cursor) => {
    if (polls++ % 5 === 0) {
      const current = await access.supabase.from("investigations").select("id")
        .eq("workspace_id", access.workspace.id).eq("id", id).maybeSingle();
      if (current.error) throw new Error("Investigation access could not be checked.");
      if (!current.data) return null;
    }
    const result = await access.supabase.from("investigation_events")
      .select("id, event_type, payload, created_at")
      .eq("workspace_id", access.workspace.id).eq("investigation_id", id)
      .in("event_type", EVENT_TYPES).filter("payload->>runId", "eq", runId)
      .gt("id", cursor).order("id", { ascending: true }).limit(100);
    if (result.error) throw new Error("Run progress is unavailable.");
    return (result.data ?? []) as StreamRunEvent[];
  }, afterId);
}

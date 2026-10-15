export type StreamRunEvent = {
  id: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export function createRunTraceStream(
  request: Request,
  loadEvents: (afterId: number) => Promise<StreamRunEvent[] | null>,
  afterId = 0,
) {
  const encoder = new TextEncoder();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: string) => { if (!cancelled) controller.enqueue(encoder.encode(value)); };
      const close = () => {
        if (cancelled) return;
        cancelled = true;
        controller.close();
      };
      void (async () => {
        let cursor = afterId;
        send("retry: 3000\n\n");
        while (!cancelled && !request.signal.aborted) {
          const events = await loadEvents(cursor);
          if (events === null) {
            send("event: run_deleted\ndata: {}\n\n");
            close();
            return;
          }
          for (const event of events) {
            if (!Number.isSafeInteger(event.id) || event.id <= cursor) continue;
            cursor = event.id;
            send(`id: ${event.id}\nevent: run_trace\ndata: ${JSON.stringify(event)}\n\n`);
            if (event.event_type === "run_completed" || event.event_type === "run_failed") { close(); return; }
          }
          if (!events.length) send(": keepalive\n\n");
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        close();
      })().catch(() => {
        send("event: run_stream_error\ndata: {\"error\":\"Run progress is temporarily unavailable.\"}\n\n");
        close();
      });
    },
    cancel() { cancelled = true; },
  });
  return new Response(body, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  } });
}

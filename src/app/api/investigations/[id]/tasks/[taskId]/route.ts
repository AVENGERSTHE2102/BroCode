import { NextResponse } from "next/server";
import { acknowledgeTaskHandoff, claimTask, completeTask, requestTaskHandoff } from "@/lib/tasks";
import { readJsonBody } from "@/lib/read-json-body";
import { requireSameOrigin } from "@/lib/same-origin";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; taskId: string }> };

export async function POST(request: Request, { params }: Context) {
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Task actions must be requested from this application origin." }, { status: 403 });
  const parsed = await readJsonBody(request, 8192);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === "too_large" ? "Task action exceeds 8 KB." : "Request body must be valid JSON." }, { status: parsed.reason === "too_large" ? 413 : 400 });
  const body = parsed.value;
  if (typeof body !== "object" || body === null || !("action" in body) || typeof body.action !== "string") {
    return NextResponse.json({ error: "Task action is required." }, { status: 400 });
  }

  try {
    const { id, taskId } = await params;
    const input = body as Record<string, unknown>;
    const result = input.action === "claim"
      ? await claimTask(request, id, taskId, typeof input.leaseSeconds === "number" ? input.leaseSeconds : 300)
      : input.action === "handoff"
        ? await requestTaskHandoff(request, id, taskId, input)
        : input.action === "acknowledge_handoff"
          ? await acknowledgeTaskHandoff(request, id, taskId)
          : input.action === "complete"
            ? await completeTask(request, id, taskId)
            : { ok: false as const, status: 400 as const, error: "Task action is unsupported." };
    return NextResponse.json(result.ok ? { result: result.data } : { error: result.error }, { status: result.ok ? 200 : result.status });
  } catch {
    return NextResponse.json({ error: "Task storage is unavailable." }, { status: 503 });
  }
}

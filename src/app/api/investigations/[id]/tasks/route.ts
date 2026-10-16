import { NextResponse } from "next/server";
import { createTask, listTasks } from "@/lib/tasks";
import { readJsonBody } from "@/lib/read-json-body";
import { requireSameOrigin } from "@/lib/same-origin";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const result = await listTasks(request, id);
    return NextResponse.json(result.ok ? { tasks: result.data } : { error: result.error }, { status: result.ok ? 200 : result.status });
  } catch {
    return NextResponse.json({ error: "Task storage is unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request, { params }: Context) {
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Tasks must be requested from this application origin." }, { status: 403 });
  const parsed = await readJsonBody(request, 16_384);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === "too_large" ? "Task request exceeds 16 KB." : "Request body must be valid JSON." }, { status: parsed.reason === "too_large" ? 413 : 400 });
  try {
    const { id } = await params;
    const result = await createTask(request, id, parsed.value);
    return NextResponse.json(result.ok ? { task: result.data } : { error: result.error }, { status: result.ok ? 201 : result.status });
  } catch {
    return NextResponse.json({ error: "Task storage is unavailable." }, { status: 503 });
  }
}

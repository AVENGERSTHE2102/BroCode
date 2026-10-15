import { NextResponse } from "next/server";
import { appendInvestigationEvent, listInvestigationEvents } from "@/lib/investigations";
import { readJsonBody } from "@/lib/read-json-body";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const result = await listInvestigationEvents(request, id);
    return NextResponse.json(result.ok ? { events: result.data } : { error: result.error }, { status: result.ok ? 200 : result.status });
  } catch {
    return NextResponse.json({ error: "Investigation storage is unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request, { params }: Context) {
  const parsed = await readJsonBody(request, 65_536);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === "too_large" ? "Event request exceeds 64 KB." : "Request body must be valid JSON." }, { status: parsed.reason === "too_large" ? 413 : 400 });
  try {
    const { id } = await params;
    const result = await appendInvestigationEvent(request, id, parsed.value);
    return NextResponse.json(result.ok ? { event: result.data, duplicate: result.duplicate } : { error: result.error }, { status: result.ok ? (result.duplicate ? 200 : 201) : result.status });
  } catch {
    return NextResponse.json({ error: "Investigation storage is unavailable." }, { status: 503 });
  }
}

import { NextResponse } from "next/server";
import { listInvestigationAttempts, recordInvestigationAttempt } from "@/lib/attempts";
import { readJsonBody } from "@/lib/read-json-body";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const result = await listInvestigationAttempts(request, id);
    return NextResponse.json(result.ok ? { attempts: result.data } : { error: result.error }, { status: result.ok ? 200 : result.status });
  } catch {
    return NextResponse.json({ error: "Attempt storage is unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request, { params }: Context) {
  const parsed = await readJsonBody(request, 32_768);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === "too_large" ? "Attempt request exceeds 32 KB." : "Request body must be valid JSON." }, { status: parsed.reason === "too_large" ? 413 : 400 });
  try {
    const { id } = await params;
    const result = await recordInvestigationAttempt(request, id, parsed.value);
    const duplicate = result.ok && typeof result.data === "object" && result.data !== null
      && "duplicate" in result.data && result.data.duplicate === true;
    return NextResponse.json(result.ok ? { attempt: result.data } : { error: result.error }, { status: result.ok ? (duplicate ? 200 : 201) : result.status });
  } catch {
    return NextResponse.json({ error: "Attempt storage is unavailable." }, { status: 503 });
  }
}

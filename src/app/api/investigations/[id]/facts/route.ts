import { NextResponse } from "next/server";
import { listInvestigationFacts, proposeInvestigationFactCandidate } from "@/lib/facts";
import { readJsonBody } from "@/lib/read-json-body";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const result = await listInvestigationFacts(request, id);
    return NextResponse.json(result.ok ? result.data : { error: result.error }, { status: result.ok ? 200 : result.status });
  } catch {
    return NextResponse.json({ error: "Fact storage is unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request, { params }: Context) {
  const parsed = await readJsonBody(request, 32_768);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === "too_large" ? "Fact request exceeds 32 KB." : "Request body must be valid JSON." }, { status: parsed.reason === "too_large" ? 413 : 400 });
  try {
    const { id } = await params;
    const result = await proposeInvestigationFactCandidate(request, id, parsed.value);
    return NextResponse.json(result.ok ? { candidate: result.data } : { error: result.error }, { status: result.ok ? 202 : result.status });
  } catch {
    return NextResponse.json({ error: "Fact storage is unavailable." }, { status: 503 });
  }
}

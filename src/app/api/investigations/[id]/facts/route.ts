import { NextResponse } from "next/server";
import { listInvestigationFacts, proposeInvestigationFactCandidate } from "@/lib/facts";
import { readJsonBody } from "@/lib/read-json-body";
import { requireSameOrigin } from "@/lib/same-origin";

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
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Facts must be requested from this application origin." }, { status: 403 });
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

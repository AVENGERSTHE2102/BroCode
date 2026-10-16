import { NextResponse } from "next/server";
import { reviewFactCandidate } from "@/lib/facts";
import { readJsonBody } from "@/lib/read-json-body";
import { requireSameOrigin } from "@/lib/same-origin";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; candidateId: string }> };

export async function POST(request: Request, { params }: Context) {
  if (!requireSameOrigin(request)) {
    return NextResponse.json({ error: "Fact review must be requested from this application origin." }, { status: 403 });
  }
  const parsed = await readJsonBody(request, 4096);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === "too_large" ? "Fact review request exceeds 4 KB." : "Request body must be valid JSON." }, { status: parsed.reason === "too_large" ? 413 : 400 });
  try {
    const { id, candidateId } = await params;
    const result = await reviewFactCandidate(request, id, candidateId, parsed.value);
    return NextResponse.json(result.ok ? { review: result.data } : { error: result.error }, { status: result.ok ? 200 : result.status });
  } catch {
    return NextResponse.json({ error: "Fact candidate review is unavailable." }, { status: 503 });
  }
}

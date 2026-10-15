import { NextResponse } from "next/server";
import { reviewActionProposal } from "@/lib/action-proposals";
import { readJsonBody } from "@/lib/read-json-body";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; proposalId: string }> };

export async function POST(request: Request, { params }: Context) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Proposal review must be requested from this application origin." }, { status: 403 });
  }
  const parsed = await readJsonBody(request, 4096);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === "too_large" ? "Proposal review request exceeds 4 KB." : "Request body must be valid JSON." }, { status: parsed.reason === "too_large" ? 413 : 400 });
  try {
    const { id, proposalId } = await params;
    const result = await reviewActionProposal(request, id, proposalId, parsed.value);
    return NextResponse.json(result.ok ? { review: result.data } : { error: result.error }, { status: result.ok ? 200 : result.status });
  } catch {
    return NextResponse.json({ error: "Proposal review storage is unavailable." }, { status: 503 });
  }
}

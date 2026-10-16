import { NextResponse } from "next/server";
import { executeActionProposal } from "@/lib/action-proposals";
import { readJsonBody } from "@/lib/read-json-body";
import { requireSameOrigin } from "@/lib/same-origin";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; proposalId: string }> };

export async function POST(request: Request, { params }: Context) {
  if (!requireSameOrigin(request)) {
    return NextResponse.json({ error: "Proposal execution must be requested from this application origin." }, { status: 403 });
  }
  const parsed = await readJsonBody(request, 8192);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === "too_large" ? "Execution request exceeds 8 KB." : "Request body must be valid JSON." }, { status: parsed.reason === "too_large" ? 413 : 400 });
  try {
    const { id, proposalId } = await params;
    const result = await executeActionProposal(request, id, proposalId, parsed.value);
    return NextResponse.json(result.ok ? { result: result.data, duplicate: result.duplicate } : { error: result.error }, { status: result.ok ? 200 : result.status });
  } catch {
    return NextResponse.json({ error: "Proposal execution could not be completed." }, { status: 503 });
  }
}

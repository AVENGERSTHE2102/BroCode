import { NextResponse } from "next/server";
import { listFactCandidates } from "@/lib/facts";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const result = await listFactCandidates(request, id);
    return NextResponse.json(result.ok ? { candidates: result.data } : { error: result.error }, { status: result.ok ? 200 : result.status });
  } catch {
    return NextResponse.json({ error: "Fact candidates are unavailable." }, { status: 503 });
  }
}

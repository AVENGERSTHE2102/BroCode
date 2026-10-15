import { NextResponse } from "next/server";
import { listInvestigationRunTraces } from "@/lib/run-trace-views";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const result = await listInvestigationRunTraces(request, id);
    return NextResponse.json(result.ok ? result.data : { error: result.error }, { status: result.ok ? 200 : result.status });
  } catch {
    return NextResponse.json({ error: "Run trace storage is unavailable." }, { status: 503 });
  }
}

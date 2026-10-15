import { NextResponse } from "next/server";
import { getInvestigation } from "@/lib/investigations";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const result = await getInvestigation(request, id);
    return NextResponse.json(result.ok ? { investigation: result.data } : { error: result.error }, { status: result.ok ? 200 : result.status });
  } catch {
    return NextResponse.json({ error: "Investigation storage is unavailable." }, { status: 503 });
  }
}

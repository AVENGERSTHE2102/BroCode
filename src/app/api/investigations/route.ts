import { NextResponse } from "next/server";
import { createInvestigation, listInvestigations } from "@/lib/investigations";
import { readJsonBody } from "@/lib/read-json-body";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const result = await listInvestigations(request);
    return NextResponse.json(result.ok ? { investigations: result.data } : { error: result.error }, { status: result.ok ? 200 : result.status });
  } catch {
    return NextResponse.json({ error: "Investigation storage is unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request, 16_384);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === "too_large" ? "Request body is too large." : "Request body must be valid JSON." }, { status: parsed.reason === "too_large" ? 413 : 400 });
  try {
    const result = await createInvestigation(request, parsed.value);
    return NextResponse.json(result.ok ? { investigation: result.data } : { error: result.error }, { status: result.ok ? 201 : result.status });
  } catch {
    return NextResponse.json({ error: "Investigation storage is unavailable." }, { status: 503 });
  }
}

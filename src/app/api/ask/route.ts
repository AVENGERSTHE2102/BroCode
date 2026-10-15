import { NextResponse } from "next/server";
import { POST as runInvestigation } from "@/app/api/investigations/[id]/run/route";
import { readJsonBody } from "@/lib/read-json-body";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
  }
  const parsed = await readJsonBody(request, 16_384);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === "too_large" ? "Request body is too large." : "Request body must be valid JSON." }, { status: parsed.reason === "too_large" ? 413 : 400 });
  const body = parsed.value;
  if (typeof body !== "object" || body === null || Array.isArray(body)
    || !("investigationId" in body) || typeof body.investigationId !== "string" || !UUID.test(body.investigationId)
    || !("question" in body) || typeof body.question !== "string"
    || !("idempotencyKey" in body) || typeof body.idempotencyKey !== "string"
    || !/^[A-Za-z0-9._:-]{1,160}$/.test(body.idempotencyKey)) {
    return NextResponse.json({ error: "A valid investigation ID, question, and idempotency key are required." }, { status: 400 });
  }
  const runId = "runId" in body ? body.runId : undefined;
  if (runId !== undefined && (typeof runId !== "string" || !UUID.test(runId))) return NextResponse.json({ error: "Run ID is invalid." }, { status: 400 });
  const headers = new Headers({ "content-type": "application/json" });
  for (const name of ["authorization", "x-waypoint-workspace"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const runRequest = new Request(request.url, {
    method: "POST", headers, signal: request.signal,
    body: JSON.stringify({ question: body.question, idempotencyKey: body.idempotencyKey, ...(typeof runId === "string" ? { runId } : {}),
      requestedWrites: { proposals: false, factCandidates: false, taskUpdates: false } }),
  });
  return runInvestigation(runRequest, { params: Promise.resolve({ id: body.investigationId }) });
}

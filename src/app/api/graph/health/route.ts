import { NextResponse } from "next/server";
import { withWorkspaceGraph } from "@/lib/falkordb";

export const runtime = "nodejs";

export async function GET() {
  try {
    await withWorkspaceGraph((query) => query("RETURN 1 AS ok"));
    return NextResponse.json({ status: "connected" });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}

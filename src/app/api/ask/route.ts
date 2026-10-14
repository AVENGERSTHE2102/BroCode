import { NextResponse } from "next/server";
import { withWorkspaceGraph } from "@/lib/falkordb";

export const runtime = "nodejs";

type EvidenceRow = [string, string, string, string, string, string[]];

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const question = typeof body === "object" && body !== null && "question" in body
    ? (body as { question?: unknown }).question
    : undefined;
  if (typeof question !== "string" || question.trim().length < 3 || question.length > 500) {
    return NextResponse.json({ error: "Question must be between 3 and 500 characters." }, { status: 400 });
  }

  if (!/payment|checkout|inc-284/i.test(question)) {
    return NextResponse.json({ error: "The connected demo graph currently contains the checkout incident (INC-284)." }, { status: 422 });
  }

  try {
    const evidence = await withWorkspaceGraph(async (query) => {
      return query<EvidenceRow>(
        `MATCH path = (incident:Incident {id: "INC-284"})-[*0..4]-(related)
         RETURN DISTINCT coalesce(related.id, related.title) AS id,
                coalesce(related.title, related.name, related.id) AS title,
                coalesce(related.kind, head(labels(related))) AS kind,
                coalesce(related.source, "") AS source,
                coalesce(related.summary, "") AS summary,
                [node IN nodes(path) | coalesce(node.title, node.name, node.id)] AS path
         LIMIT 30`,
        3000,
      );
    });

    if (!evidence.length) {
      return NextResponse.json({ error: "No accessible graph evidence was found for INC-284." }, { status: 404 });
    }

    const records = evidence.map(([id, title, kind, source, summary, path]) => ({ id, title, kind, source, summary, path }));
    const answer = records
      .filter((item) => ["deploy-1842", "INC-284", "decision-retry", "deploy-1837"].includes(item.id) && item.summary)
      .map((item) => item.summary)
      .join(" ");

    return NextResponse.json({
      answer: answer || `The graph returned ${records.length} connected records for INC-284.`,
      sources: records.filter((item) => item.source).map(({ title, kind, source }) => ({ title, kind, source })),
      path: records.find((item) => item.id === "INC-284")?.path ?? records[0].path,
      hopLimit: 4,
      source: "falkordb",
    });
  } catch (error) {
    const unavailable = error instanceof Error && /FALKORDB_URL/.test(error.message);
    return NextResponse.json(
      { error: unavailable ? "FalkorDB Cloud is not configured." : "FalkorDB Cloud could not answer this question." },
      { status: unavailable ? 503 : 502 },
    );
  }
}

import { runGraphProjectionBatch } from "@/lib/graph-projection-worker";

try {
  console.log(JSON.stringify(await runGraphProjectionBatch()));
} catch {
  console.error("Graph projection worker failed.");
  process.exitCode = 1;
}

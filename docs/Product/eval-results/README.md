# Eval results

Raw output of `bun run eval:compare`, saved for reference. Each file is the
unmodified JSON report (see `TESTING.md` §4 for how to read it and
`scripts/run-evaluation-comparison.ts` for how it's produced).

## Runs

| File | Model | Completed | Failed |
|---|---|---|---|
| `2026-10-16-gpt-oss-20b.json` | `openai/gpt-oss-20b` (Groq) | 14/14 all 3 modes | 0 |
| `2026-10-16-gpt-4o-mini.json` | `gpt-4o-mini` (OpenAI) | 14/14 all 3 modes | 0 |

Both runs cover all 14 cases — the 11 synthetic fixtures
(`engineering-incidents.v1.json`, `domain-workflows.v1.json`) plus the 3
LoCoMo-derived external-benchmark cases (`locomo-external.v1.json`) — in all
three retrieval modes (`graph_agent`, `text_retrieval`, `markdown_memory`)
under an equal byte/token budget. Zero failures across two different
providers and models.

On the adversarial false-premise case, `graph_agent` correctly abstained on
both models rather than answering from a false premise. Per-case answers,
F1 scores, abstentions, and tool traces for every mode are in the JSON
reports.

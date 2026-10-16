# Eval results

Raw output of `bun run eval:compare`, saved for reference. Each file is the
unmodified JSON report (see `TESTING.md` §4 for how to read it and
`scripts/run-evaluation-comparison.ts` for how it's produced).

## 2026-10-16-gpt-oss-20b.json

- **Model:** `openai/gpt-oss-20b` via Groq.
- **Cases:** all 14 — the 11 synthetic fixtures (`engineering-incidents.v1.json`,
  `domain-workflows.v1.json`) plus the 3 LoCoMo-derived external-benchmark
  cases (`locomo-external.v1.json`).
- **Headline:** 14/14 completed in all three modes (`graph_agent`,
  `text_retrieval`, `markdown_memory`), zero failures — the first fully
  clean live run, after fixing three bugs found by running this exact
  command against a real model (see `IMPLEMENTATION_TRACKER.md`'s
  2026-10-16 entry and `TESTING.md` §6 for what they were).
- **Notable result:** on `locomo-realization-attribution-adversarial` (a
  false-premise question), `graph_agent` correctly abstained while
  `text_retrieval` and `markdown_memory` both answered anyway. This is a
  real, single-case result — not a statistically significant claim on its
  own — but it's a concrete, honest instance of the graph-helps thesis
  this project is built around, and it's citable because the case and the
  model's actual behavior are both in this file.
- **Also notable:** the `graph_agent` mode missed `locomo-temporal-support-group-date`
  (a relative-date subtraction question) and `locomo-realization-attribution-correct`
  (abstained when it shouldn't have) — real, current weaknesses, not
  hidden. Report these alongside the win above; don't cherry-pick.
- **Caveat:** `gpt-oss-20b` was chosen for reliable iteration under Groq's
  free-tier rate limits, not because it's the strongest available model.
  Re-run with `gpt-oss-120b` or a real OpenAI model before using these
  numbers in anything final (pitch deck, blog post, submission) — see
  `TESTING.md` §2.3.

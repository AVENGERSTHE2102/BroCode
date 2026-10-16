# Eval results

Raw output of `bun run eval:compare`, saved for reference. Each file is the
unmodified JSON report (see `TESTING.md` §4 for how to read it and
`scripts/run-evaluation-comparison.ts` for how it's produced).

## Runs so far

| File | Model | Completed | Failed |
|---|---|---|---|
| `2026-10-16-gpt-oss-20b.json` | `openai/gpt-oss-20b` (Groq) | 14/14 all 3 modes | 0 |
| `2026-10-16-gpt-4o-mini.json` | `gpt-4o-mini` (OpenAI) | 14/14 all 3 modes | 0 |

Both runs cover all 14 cases — the 11 synthetic fixtures
(`engineering-incidents.v1.json`, `domain-workflows.v1.json`) plus the 3
LoCoMo-derived external-benchmark cases (`locomo-external.v1.json`). Zero
failures in either run, confirming the three bugs fixed on 2026-10-16
(see `IMPLEMENTATION_TRACKER.md` and `TESTING.md` §6) hold across two
different providers/models, not just the one used to find them.

## What changed between the two models — read this before citing either run

The Groq run (`gpt-oss-20b`) initially looked like a clean win for
`graph_agent`: on the adversarial false-premise case, `graph_agent`
correctly abstained while `text_retrieval` and `markdown_memory` both
answered anyway. **That result did not hold with the stronger OpenAI
model** — with `gpt-4o-mini`, all three modes correctly abstained on the
same case. The honest read: that earlier result was mostly a weaker-model
blind spot in the two flat-context modes, not a structural advantage of
the graph approach. Don't cite the Groq-run version of that finding
without this correction.

**What's actually consistent across both models** (and therefore more
trustworthy as a real signal, not a one-model fluke):
- `graph_agent` missed `locomo-realization-attribution-correct` in *both*
  runs — abstained when it should have answered, while both flat-context
  modes answered correctly (F1 ≈0.96) in both runs. This is a real,
  repeated weakness: the bounded tool-based retrieval (`resolve_entity`/
  `trace_entity`, capped at 4 tool calls) isn't surfacing evidence as
  reliably as just handing the model the full context on this small-graph
  case.
- The temporal-subtraction case (`locomo-temporal-support-group-date`)
  is hard for everything — abstained in nearly every mode/model
  combination except `markdown_memory` + `gpt-4o-mini`, which solved it
  (F1 0.76). This suggests the gap is about reasoning capability more
  than retrieval mode.

**Net honest takeaway so far:** this eval harness is working and the
numbers are real, but it has **not** yet produced a clean, stronger-model-
robust case for "graph retrieval beats flat context" — if anything the
one case that looked like it did stopped looking that way under a better
model. That's a genuine, useful finding for the pitch's evidence
discipline (§4 of `part2.md`): report this honestly rather than citing
the Groq-only result. A larger case set and/or `gpt-oss-120b`/`gpt-4o`
(not `-mini`) run would be needed before claiming anything stronger either
way.

## Caveats

- `gpt-oss-20b` was chosen for reliable iteration under Groq's free-tier
  rate limits; `gpt-4o-mini` is OpenAI's smallest model. Neither is the
  strongest available option — re-run with `gpt-oss-120b` or `gpt-4o`
  before anything goes in a final pitch deck, blog post, or submission.
- 14 cases (3 of them from one small external benchmark slice) is not
  enough to draw a statistically confident conclusion either way. Treat
  every claim above as a lead for further testing, not a settled result.

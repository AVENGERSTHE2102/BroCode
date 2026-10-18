# Development guide

## Package manager

Bun 1.3.9, exclusively. `bun.lock` is the single lockfile — never generate or commit an
`npm`/`yarn`/`pnpm` lockfile alongside it. Use `bun install`, `bun add`/`bun remove`, and
`bun run <script>`.

## Before opening a PR

```bash
bun run typecheck
bun run test:contracts
bun run build
```

All three must pass. `test:contracts` chains 27 scripts under `scripts/check-*.ts` — each
should print one confirmation line and never touch a real network (they mock
fetch/inputs). A CI workflow runs the same three checks on Ubuntu with Bun 1.3.9 and no
cloud secrets; see `docs/Operations/OPERATIONS_GUIDE.md` for what counts as stronger
evidence than "CI is green."

Run a single check directly while iterating: `bun run test:graph-acl`,
`bun run test:mcp-sdk`, etc. — see `package.json`'s `scripts` block for the full list.

## Running Python scripts (video production tooling only)

The app itself has no Python dependency. The `video/` Remotion project's voice-over script
(`make_vo.py`) does — run it through conda:

```powershell
C:\Users\Deep\anaconda3\shell\condabin\conda-hook.ps1 ; conda activate base
python video/make_vo.py
```

## Conventions worth knowing before touching specific areas

- **Migrations**: `CREATE OR REPLACE FUNCTION` does not replace a function whose
  parameter list changed — it silently creates a second overload. Changing an RPC's
  signature needs an explicit `DROP FUNCTION IF EXISTS` in a follow-up migration; see
  `docs/Database/DATABASE_DESIGN.md` and `TESTING.md` §2.4 for the verification query.
- **Agent runner retries**: don't reintroduce the three model-call gotchas documented in
  `docs/Backend/BACKEND_GUIDE.md` and `TESTING.md` §6 — they were each found by actually
  running against a live model, not by reading the code.
- **FalkorDB diagnostics**: `bun run diagnose:falkordb` is intentionally cloud
  (`falkors://`) only — see Decision D4 in `docs/Decisions/DECISIONS.md`.
- **No Docker in the app itself** — the one sanctioned exception is local FalkorDB during
  development, documented and dated in `docs/Deployment/DEPLOYMENT_GUIDE.md`.

## Reporting status honestly

This repo treats "typecheck passes" and "it works" as different claims. Before marking
anything `done` in `IMPLEMENTATION_TRACKER.md`, say which of `TESTING.md` §5's four
evidence levels you actually reached, and record the evidence. See
`docs/Product/IMPACT_AND_EVIDENCE.md` for a worked example of this discipline applied to
the whole product.

## Contributors

See the root [README](../../README.md#contributors). There is no formal
`CONTRIBUTING.md` process beyond the checks above — open a PR against `main`.

# Repository instructions

Before working on Waypoint, read [IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md). It is the source of truth for delivery scope, dependencies, decisions, blockers, and completion evidence.

After meaningful implementation or verification, update the tracker before ending the work session. Mark an item `done` only when its acceptance criteria have supporting evidence. Record blockers and the next action for incomplete work, and continue independent work that does not depend on the blocker. Do not store credentials or secret values in the tracker or repository.

Product constraints: Agents That Act on Connected Data is the primary track; Company Brain and Agent Memory and Coordination must support the same real engineering workflow. Use cloud-hosted databases and services. Do not use Docker. Synthetic records are allowed for automated tests, but do not count as proof of real integration or product acceptance. Agents may propose actions; a human must approve before execution.

Use Bun 1.3.9 as the package manager. Keep `bun.lock` committed and do not regenerate or commit npm/yarn/pnpm lockfiles. Use `bun install`, `bun add`/`bun remove`, and `bun run <script>`.

# Waypoint

Waypoint is a shared context workspace for engineering agents. It brings connected company knowledge, durable agent memory, coordination, and human-approved actions into one product.

## Run the web preview

```sh
npm install
cp .env.example .env.local
# Replace the example values with the FalkorDB Cloud connection URL and graph name.
npm run seed:demo
npm run dev
```

The seeded Northwind Labs graph is synthetic. Questions about checkout/payment/INC-284 use a bounded four-hop query against FalkorDB Cloud when configured; otherwise the UI labels its bundled answer as a demo fallback. Approval and handoff remain local previews. Authentication, workspace membership, imports, durable memory, and action execution are not wired yet.

See [the graph model and Cypher](docs/graph-model.md), [the release runbook](docs/release-runbook.md), and the [demo recording guide](docs/demo-script.md). The full build plan is in [MASTER_PLAN.md](MASTER_PLAN.md).

## Submission notes

Intended tracks: **Agents That Act on Connected Data**, **Agent Memory and Coordination**, and **Company Brain**. AI coding assistant disclosure: this project was developed with OpenAI Codex; the team is responsible for reviewing and validating the implementation.

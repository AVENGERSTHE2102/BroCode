# Alpha workflow recording guide

Record a product walkthrough only after the real-data release gates in [IMPLEMENTATION_TRACKER.md](../IMPLEMENTATION_TRACKER.md) pass. Do not use seeded company records, mocked sources, bundled answers, or local-preview actions as evidence.

The recording should show an authorized GitHub repository and deployed non-production service; one incident investigated through MCP-selected graph paths; the source revisions and prior attempts that influence the decision; an explicit human approval bound to the proposed action; provider-side execution and health verification; and the same investigation outcome recovered in a fresh session.

If an integration, approval, action, or outcome cannot be verified from its provider, label the walkthrough incomplete and do not present it as a working alpha.

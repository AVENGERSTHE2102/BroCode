# Operations and data handling

Waypoint currently uses Supabase Auth/Postgres as the identity and workflow system of record and FalkorDB Cloud for graph queries/projections. The application host and its scheduler are selected and operated manually by the deployer. No Docker setup is used.

## Credentials

| Credential | Use | Exposure |
|---|---|---|
| Supabase publishable key and project URL | Browser/server Auth client | Public configuration; still restrict allowed auth redirect URLs in Supabase. |
| Supabase service-role key | Projection worker and restricted database RPCs | Server-only secret; never use in client components or `NEXT_PUBLIC_` variables. |
| FalkorDB Cloud TLS URL | Graph reads, writes, and projection | Server-only secret; require `falkors://`. |
| GitHub App ID/private key, client ID/secret, slug, and state-signing key | Bind an authorized installation and connect a selected repository | Server-only secrets; OAuth state binds the callback to the current workspace user. Source list/import tokens are short-lived, one-repository, and read-only, with Checks read for bounded default-branch CI evidence. A separate execution token is issued only after exact owner/admin approval and is scoped to one repository with Contents/Pull requests write and Checks/Commit statuses read; every token is revoked after its request and none is stored. |
| Deployment credentials | Not connected yet | Do not add until a provider and least-privilege scope are selected. |

Keep secrets in the selected host's secret manager and in ignored local `.env.local`; never commit them or paste them into the tracker. To rotate a server credential, provision its replacement, update the host secret, restart the app and scheduled worker, verify the relevant health/query path, then revoke the old credential. The authenticated `/api/graph/health` endpoint reports FalkorDB status, latency, and a sanitized error code without exposing the endpoint URL or credentials. If a secret may have leaked, revoke it immediately and review provider audit logs before restoring service.

## Deletion and retention

An owner/admin can request permanent investigation deletion. The app deletes the Postgres investigation and cascaded workflow rows, invalidates open proposals, waits for the graph outbox, verifies that projected nodes and edges are gone, and then records completion. A dead-lettered or unavailable graph projection keeps deletion pending; do not report deletion as complete or manually mark the request complete.

When deletion is confirmed in the active browser, the UI aborts its agent request. The server also checks that the investigation still exists before and after model and tool calls and before returning an answer, preventing a tool result from being sent to another model step after deletion. A prompt already submitted to an external model provider cannot be recalled; provider logs and retention follow that provider's policy and must be disclosed and configured separately. Deletion does not purge external model-provider logs.

This removes live application records. It does not guarantee immediate removal from managed database backups, point-in-time recovery snapshots, provider logs, or exported backups. Configure and disclose the chosen providers' retention windows before accepting customer data. The actual Supabase/FalkorDB retention settings have not been verified in this workspace.

## Recovery

Postgres is authoritative for workflow state. After restoring Postgres, first verify workspace membership and RLS, then run the graph projection worker to drain the transactional outbox. Inspect queue health and dead-lettered events; replay failed events through the restricted database function only after fixing the underlying cause. The graph projection worker is idempotent and protected by database leases.

No end-to-end backup restore or graph rebuild has been tested. Source ingestion currently covers bounded GitHub metadata and history only; fraud/security adapters and a verified full graph rebuild procedure remain open. Set and test RPO/RTO targets with the selected managed-service plans before alpha use.

## Incident response

For suspected credential exposure, revoke/rotate the affected provider credential and pause the host scheduler if the service-role or graph credential is involved. Keep Postgres writes available only if the outbox can safely retain them. For projection outages, leave the outbox intact, restore graph connectivity, then resume the worker and verify pending/dead counts. Record the incident, affected workspace scope, credential rotation, recovery evidence, and any data-retention impact without copying secrets or restricted content into logs.

## Unverified operational gates

- Provider backup/PITR configuration, retention windows, and restore procedures.
- Host secret-manager access controls, rotation automation, scheduler cadence, and alert delivery.
- Recovery exercise covering Supabase restore, outbox replay, and FalkorDB verification.
- Customer-facing deletion, retention, and incident-response commitments.

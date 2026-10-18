# Operations guide

## Credential boundaries

| Credential | Use | Exposure |
|---|---|---|
| Supabase publishable key + project URL | Browser/server Auth client | Public configuration; still restrict allowed auth redirect URLs in Supabase. |
| Supabase service-role key | Projection worker + restricted RPCs | Server-only; never in client components or `NEXT_PUBLIC_*`. |
| FalkorDB URL | Graph reads/writes/projection | Server-only; cloud deployments must use `falkors://` (TLS). |
| GitHub App credentials | Source connection + draft-PR execution | Server-only. OAuth state is signed and bound to the current workspace/user. Listing/import tokens are short-lived, single-repository, read-only. The execution token is issued only after exact owner/admin approval, scoped to one repository with `contents:write` + `pull_requests:write` + `checks:read`/`statuses:read`, and revoked immediately after the request — none of these tokens are ever stored. |
| Deployment provider credentials | Not connected yet | Do not add until a provider and least-privilege scope are selected. |

Keep secrets in the host's secret manager and in a gitignored `.env`; never commit them or
paste them into `IMPLEMENTATION_TRACKER.md` or any other tracked file. To rotate a server
credential: provision the replacement, update the host secret, restart the app and
scheduled worker, verify the relevant health/query path, **then** revoke the old
credential. `GET /api/graph/health` (authenticated) reports FalkorDB status and latency
without exposing the endpoint URL or credentials — use it to confirm rotation worked
before revoking the old key. If a secret may have leaked, revoke it immediately and check
provider audit logs before restoring service.

## Deletion and retention

An owner/admin can request permanent investigation deletion
(`POST /api/investigations/:id/forget`). The service deletes the Postgres investigation
and every cascaded workflow row, invalidates open proposals, waits for the graph-outbox
barrier, verifies that the projected nodes/edges are actually gone, and only then records
completion — a dead-lettered or unreachable graph projection keeps the request **pending**,
not silently marked done.

If deletion is confirmed while the browser has an active agent run open, the UI aborts
that request client-side, and the server independently re-checks that the investigation
still exists before and after every model/tool call and before returning an answer — so a
tool result can't be forwarded to a later model step after the data it came from was
deleted. A prompt already sent to an external model provider cannot be recalled; that
provider's own log retention applies and must be disclosed/configured separately —
deletion here does **not** purge model-provider logs.

This removes live application records only. It does not guarantee immediate removal from
managed database backups, point-in-time-recovery snapshots, or exported backups —
configure and disclose the selected providers' retention windows before accepting real
customer data. Actual Supabase/FalkorDB retention settings have not been verified in this
environment.

## Recovery

Postgres is authoritative for workflow state. After restoring Postgres: verify workspace
membership/RLS first, then run `worker:graph-projection` to drain the transactional
outbox from scratch. Inspect queue depth and dead-lettered rows; only replay failed events
(through the restricted database function) after fixing the underlying cause — the worker
is idempotent and lease-protected, so a safe replay is always possible once the cause is
fixed.

No end-to-end backup-restore or full graph rebuild has been exercised in this environment.
Source ingestion currently covers bounded GitHub metadata only; a verified full rebuild
procedure, and fraud/security source recovery, remain open. Set and test RPO/RTO targets
against the selected managed-service plans before any real alpha use.

## Incident response

Suspected credential exposure: revoke/rotate the affected credential immediately, and
pause the host scheduler if the service-role key or the graph credential is involved
(Postgres writes stay safe as long as the outbox can retain them). For a projection
outage: leave the outbox intact, restore graph connectivity, resume the worker, verify
pending/dead-letter counts return to normal. Record every incident — affected workspace
scope, credential rotation performed, recovery evidence, any data-retention impact —
without ever copying secrets or restricted content into logs or tracker files.

## Manual verification runbook (for recording a demo or doing a release check)

Before recording any product walkthrough, make sure the real-data gates in
`IMPLEMENTATION_TRACKER.md` that the walkthrough depends on have actually passed — don't
use seeded/synthetic records, mocked sources, or the sample graph as if they were live
evidence (the sample graph is explicitly tagged `sample: true` for exactly this reason;
see `docs/Frontend/FRONTEND_GUIDE.md`).

A complete walkthrough shows, in order: an authorized real source connected; one
investigation traced through MCP-selected graph paths with the source revisions and prior
attempts that influenced it; an explicit human approval bound to a specific proposed
action; provider-side execution and verification of the result; and the same investigation
recovered intact in a fresh session. If any one of those can't currently be verified from
its real provider, **say so on screen** — label that segment as not-yet-connected or
illustrative rather than presenting it as working. This is exactly the standard
`video/README.md` documents applying to the submission video itself.

## Unverified operational gates (honest list)

- Provider backup/PITR configuration, retention windows, and a tested restore procedure.
- Host secret-manager access controls, rotation automation, scheduler alerting.
- A full recovery exercise: Supabase restore → outbox replay → FalkorDB re-verification.
- Any customer-facing deletion/retention/incident-response commitment — none should be
  made until the above are actually exercised.

// Clearly-labelled synthetic sample (sample=true, source ids prefixed "sample:") so the product can be demonstrated
// before a real source is connected. It is never treated as proof of a real integration.
// Story: a small engineering org. INC-2041 (checkout failures) traces to PR #142's retry change; a past attempt failed;
// a second incident and a security advisory share the same dependency; people, teams, decisions and docs tie it together.
export const SAMPLE_VERSION = "sample-v2";
type N = [label: string, id: string, title: string];
export const SAMPLE_NODES: N[] = [
  // Code
  ["Repository", "sample:repo/checkout", "acme/checkout"], ["Repository", "sample:repo/payments", "acme/payments"],
  ["Service", "sample:svc/checkout", "Checkout service"], ["Service", "sample:svc/payments", "Payments API"],
  ["Service", "sample:svc/notifications", "Notifications service"], ["Service", "sample:svc/ledger", "Ledger service"],
  ["File", "sample:file/checkout.ts", "src/checkout.ts"], ["File", "sample:file/retry.ts", "src/retry.ts"],
  ["File", "sample:file/client.ts", "src/payments/client.ts"], ["File", "sample:file/package.json", "package.json"],
  ["PullRequest", "sample:pr/142", "PR #142 — Add retry logic to payment calls"], ["PullRequest", "sample:pr/138", "PR #138 — Bump payments SDK"],
  ["PullRequest", "sample:pr/151", "PR #151 — Cap retries and add timeout guard"], ["PullRequest", "sample:pr/97", "PR #97 — Ledger double-write fix"],
  ["Commit", "sample:commit/a41f9c", "a41f9c — retry without timeout guard"], ["Commit", "sample:commit/77be02", "77be02 — bump payments-sdk to 5.2"],
  ["CheckRun", "sample:check/e2e", "CI e2e-checkout — failing"],
  // Operations
  ["Incident", "sample:inc/2041", "INC-2041 — Checkout failures spike"], ["Incident", "sample:inc/1987", "INC-1987 — Duplicate ledger entries"],
  ["Issue", "sample:issue/212", "Issue #212 — Customers charged but order missing"],
  ["Attempt", "sample:attempt/timeout", "Attempt: raise timeout to 30s — no improvement"],
  ["Attempt", "sample:attempt/rollback", "Attempt: roll back payments SDK — partial"],
  ["SecurityFinding", "sample:sf/axios", "Advisory: axios-retry ReDoS"], ["Dependency", "sample:dep/axios-retry", "axios-retry@4.0.0"],
  // People and organisation
  ["Person", "sample:person/maya", "Maya Chen"], ["Person", "sample:person/ravi", "Ravi Patel"], ["Person", "sample:person/lena", "Lena Ortiz"],
  ["Person", "sample:person/sam", "Sam Okafor"], ["Person", "sample:person/priya", "Priya Nair"],
  ["Team", "sample:team/checkout", "Checkout team"], ["Team", "sample:team/payments", "Payments team"], ["Team", "sample:team/platform", "Platform team"],
  ["Project", "sample:project/reliability", "Q4 Payments reliability"],
  // Knowledge
  ["Decision", "sample:dec/17", "Decision: exponential retry (ADR-17)"], ["Decision", "sample:dec/21", "Decision: idempotency keys on payment writes (ADR-21)"],
  ["Document", "sample:doc/adr-17", "ADR-17: Retry policy"], ["Document", "sample:doc/adr-21", "ADR-21: Payment idempotency"],
  ["Document", "sample:doc/runbook", "Checkout runbook"], ["Document", "sample:doc/postmortem-1987", "Postmortem: INC-1987"],
];
type E = [from: string, type: string, to: string];
export const SAMPLE_EDGES: E[] = [
  // Code structure
  ["sample:repo/checkout", "CONTAINS", "sample:file/checkout.ts"], ["sample:repo/checkout", "CONTAINS", "sample:file/retry.ts"],
  ["sample:repo/checkout", "CONTAINS", "sample:file/package.json"], ["sample:repo/payments", "CONTAINS", "sample:file/client.ts"],
  ["sample:file/checkout.ts", "PART_OF", "sample:svc/checkout"], ["sample:file/retry.ts", "PART_OF", "sample:svc/checkout"],
  ["sample:file/client.ts", "PART_OF", "sample:svc/payments"],
  ["sample:svc/checkout", "DEPENDS_ON", "sample:svc/payments"], ["sample:svc/checkout", "DEPENDS_ON", "sample:svc/notifications"],
  ["sample:svc/payments", "DEPENDS_ON", "sample:svc/ledger"],
  // Changes
  ["sample:pr/142", "MODIFIES", "sample:file/retry.ts"], ["sample:pr/142", "MODIFIES", "sample:file/checkout.ts"],
  ["sample:commit/a41f9c", "PART_OF", "sample:pr/142"], ["sample:check/e2e", "FAILED_ON", "sample:commit/a41f9c"],
  ["sample:pr/138", "MODIFIES", "sample:file/client.ts"], ["sample:commit/77be02", "PART_OF", "sample:pr/138"],
  ["sample:pr/151", "MODIFIES", "sample:file/retry.ts"], ["sample:pr/151", "REFERENCES", "sample:inc/2041"],
  ["sample:pr/97", "MODIFIES", "sample:file/client.ts"], ["sample:pr/97", "IMPLEMENTS", "sample:dec/21"],
  // Incidents and memory
  ["sample:inc/2041", "AFFECTS", "sample:svc/checkout"], ["sample:inc/2041", "SUSPECTED_CAUSE", "sample:pr/142"],
  ["sample:issue/212", "REFERENCES", "sample:inc/2041"], ["sample:issue/212", "AFFECTS", "sample:svc/payments"],
  ["sample:attempt/timeout", "TRIED_FOR", "sample:inc/2041"], ["sample:attempt/rollback", "TRIED_FOR", "sample:inc/2041"],
  ["sample:attempt/rollback", "REVERTED", "sample:pr/138"],
  ["sample:inc/1987", "AFFECTS", "sample:svc/ledger"], ["sample:inc/1987", "RESOLVED_BY", "sample:pr/97"], ["sample:doc/postmortem-1987", "DESCRIBES", "sample:inc/1987"],
  ["sample:sf/axios", "AFFECTS", "sample:dep/axios-retry"], ["sample:dep/axios-retry", "USED_BY", "sample:svc/checkout"],
  ["sample:dep/axios-retry", "DECLARED_IN", "sample:file/package.json"],
  // People
  ["sample:person/maya", "AUTHORED", "sample:pr/142"], ["sample:person/maya", "AUTHORED", "sample:commit/a41f9c"], ["sample:person/maya", "OWNS", "sample:svc/checkout"],
  ["sample:person/maya", "MEMBER_OF", "sample:team/checkout"],
  ["sample:person/ravi", "AUTHORED", "sample:pr/138"], ["sample:person/ravi", "AUTHORED", "sample:commit/77be02"], ["sample:person/ravi", "OWNS", "sample:svc/payments"],
  ["sample:person/ravi", "MEMBER_OF", "sample:team/payments"],
  ["sample:person/lena", "AUTHORED", "sample:pr/151"], ["sample:person/lena", "REVIEWED", "sample:pr/142"], ["sample:person/lena", "MEMBER_OF", "sample:team/checkout"],
  ["sample:person/lena", "AUTHORED", "sample:doc/runbook"],
  ["sample:person/sam", "AUTHORED", "sample:pr/97"], ["sample:person/sam", "AUTHORED", "sample:doc/postmortem-1987"], ["sample:person/sam", "MEMBER_OF", "sample:team/platform"],
  ["sample:person/sam", "OWNS", "sample:svc/ledger"],
  ["sample:person/priya", "LEADS", "sample:project/reliability"], ["sample:person/priya", "MEMBER_OF", "sample:team/payments"],
  ["sample:person/priya", "DECIDED", "sample:dec/21"], ["sample:person/maya", "DECIDED", "sample:dec/17"],
  ["sample:team/payments", "ON_CALL_FOR", "sample:svc/payments"], ["sample:team/checkout", "ON_CALL_FOR", "sample:svc/checkout"],
  ["sample:team/platform", "ON_CALL_FOR", "sample:svc/notifications"],
  ["sample:project/reliability", "INCLUDES", "sample:svc/payments"], ["sample:project/reliability", "INCLUDES", "sample:svc/checkout"],
  // Decisions and docs
  ["sample:pr/142", "IMPLEMENTS", "sample:dec/17"], ["sample:dec/17", "DOCUMENTED_IN", "sample:doc/adr-17"],
  ["sample:dec/21", "DOCUMENTED_IN", "sample:doc/adr-21"], ["sample:doc/runbook", "DESCRIBES", "sample:svc/checkout"],
];

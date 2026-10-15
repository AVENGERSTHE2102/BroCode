export const WORKFLOW_DOMAINS = ["general", "fraud_investigation", "security_triage", "codebase_work"] as const;
export type WorkflowDomain = typeof WORKFLOW_DOMAINS[number];

const labels: Record<WorkflowDomain, string> = {
  general: "General investigation",
  fraud_investigation: "Fraud investigation",
  security_triage: "Security triage",
  codebase_work: "Codebase work",
};

const instructions: Record<WorkflowDomain, string> = {
  general: "Apply the evidence, access, uncertainty, and human-approval rules to the user's investigation without assuming a domain.",
  fraud_investigation: "FRAUD WORKFLOW: Trace transactions across accounts, devices, counterparties, and prior cases. Treat patterns as risk signals, never proof of intent or fraud. Separate observed facts from hypotheses, call out missing coverage and benign explanations, and do not recommend adverse action based only on graph proximity or a risk score. Any operational action is only a proposal for human review.",
  security_triage: "SECURITY WORKFLOW: Trace findings through affected package/version, repository, changed files, CI checks, service, and deployment evidence when available. Distinguish severity from demonstrated reachability or exploitability, identify missing version/exposure evidence, and prioritize evidence-backed remediation. Any code change is only a reviewed draft proposal; never claim a vulnerability is fixed without an observed provider result.",
  codebase_work: "CODEBASE WORKFLOW: Trace repository, commit, pull request, changed file, check run, ownership, and prior-attempt evidence. Use exact source revisions and successful checks; a file path or temporal correlation alone does not establish causation. Any patch must target an observed repository/ref/base SHA and remain a human-reviewed draft proposal.",
};

export function isWorkflowDomain(value: unknown): value is WorkflowDomain {
  return typeof value === "string" && (WORKFLOW_DOMAINS as readonly string[]).includes(value);
}

export function workflowDomainLabel(value: unknown) {
  return isWorkflowDomain(value) ? labels[value] : labels.general;
}

export function workflowDomainInstructions(value: unknown) {
  return instructions[isWorkflowDomain(value) ? value : "general"];
}

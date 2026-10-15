function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validatePriorAttemptReview(inputs: Record<string, unknown>, failedKeys: string[], evidence: unknown[]) {
  if (!failedKeys.length) return true;
  const reviews = inputs.priorAttemptReview;
  if (!Array.isArray(reviews) || reviews.length !== failedKeys.length) return false;
  const allowedEvidence = new Set(evidence.flatMap((item) => record(item)
    && typeof item.sourceId === "string" && typeof item.version === "string"
    ? [`${item.sourceId}\u0000${item.version}`] : []));
  const byKey = new Map<string, Record<string, unknown>>();
  for (const item of reviews) {
    if (!record(item) || typeof item.attemptKey !== "string" || byKey.has(item.attemptKey)
      || !failedKeys.includes(item.attemptKey) || !["applies", "not_applicable"].includes(String(item.applicability))
      || typeof item.explanation !== "string" || !item.explanation.trim() || item.explanation.length > 1000
      || !Array.isArray(item.evidence) || item.evidence.length === 0 || item.evidence.length > 10
      || !Array.isArray(item.changedConditions) || item.changedConditions.length > 10) return false;
    const cited = (refs: unknown[]) => refs.every((ref) => record(ref) && typeof ref.sourceId === "string"
      && typeof ref.version === "string" && allowedEvidence.has(`${ref.sourceId}\u0000${ref.version}`));
    if (!cited(item.evidence) || !cited(item.changedConditions.map((condition) => record(condition)
      ? condition : null))) return false;
    if (item.changedConditions.some((condition) => !record(condition) || typeof condition.description !== "string"
      || !condition.description.trim() || condition.description.length > 500)) return false;
    if (item.applicability === "applies" && item.changedConditions.length === 0) return false;
    byKey.set(item.attemptKey, item);
  }
  return failedKeys.every((key) => byKey.has(key));
}

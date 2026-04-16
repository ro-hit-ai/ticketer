export function getThreadTitle(thread) {
  return thread?.subject || `Verification – ${thread?.sourceCaseId || "Unknown"}`;
}

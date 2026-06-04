const SUCCESS_STATUSES = new Set(["completed", "success", "succeeded"]);
const FAILURE_STATUSES = new Set([
  "failed",
  "cancelled",
  "canceled",
  "error",
  "timeout",
  "aborted",
  "blocked",
]);

export function subagentStatusOk(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  if (!normalized) return false;
  if (FAILURE_STATUSES.has(normalized)) return false;
  return SUCCESS_STATUSES.has(normalized);
}

export function subagentStatusBlockedReason(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (!normalized) return "subagent status missing";
  if (FAILURE_STATUSES.has(normalized)) return `subagent status "${normalized}"`;
  if (!SUCCESS_STATUSES.has(normalized)) return `subagent status "${normalized}" unknown`;
  return "";
}

export type HandoffRequired = {
  files_read: string[];
  claims: string[];
  evidence: string[];
  uncertainty: string[];
};

export function validateHandoff(handoff: unknown): handoff is HandoffRequired {
  if (!handoff || typeof handoff !== "object") return false;
  const h = handoff as Record<string, unknown>;
  return (
    Array.isArray(h.files_read) &&
    Array.isArray(h.claims) &&
    Array.isArray(h.evidence) &&
    Array.isArray(h.uncertainty)
  );
}

export function handoffMissingMessage(): string {
  return [
    "SUBAGENT_HANDOFF required before this unit can be marked done.",
    "Provide a structured handoff with:",
    "  FILES_READ: list of files actually inspected",
    "  CLAIMS: what you found/changed",
    "  EVIDENCE: proof artifacts (test output, file paths)",
    "  UNCERTAINTY: residual gaps or unknowns",
    "",
    "Resubmit with this information to complete the unit.",
  ].join("\n");
}

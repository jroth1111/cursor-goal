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

const DESTRUCTIVE_SHELL =
  /\b(rm\s+-rf|git\s+push\s+--force|drop\s+database)\b/i;

export function shellCommandAllowed(
  cmd: string,
): boolean {
  const trimmed = cmd.trim();
  if (!trimmed) return true;
  return !DESTRUCTIVE_SHELL.test(trimmed);
}

export type ShellGateResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Shared shell gate for preToolUse (Shell/Bash) and beforeShellExecution.
 * Both hooks must call this — Cursor may invoke shell via either path.
 *
 * Note: proof-plan.json compiles shell_allowlist/shell_patterns as metadata,
 * but stop-time shell enforcement is not yet wired. Only the destructive
 * pattern deny-list is active.
 */
export async function checkShellGate(
  cmd: string,
  _root?: string,
): Promise<ShellGateResult> {
  const trimmed = cmd.trim();
  if (!trimmed) return { allowed: true };

  if (!shellCommandAllowed(trimmed)) {
    return {
      allowed: false,
      reason: "Destructive command blocked by cursor-goal-runtime.",
    };
  }

  return { allowed: true };
}

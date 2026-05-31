function hasDropDatabase(cmd: string): boolean {
  return /\bdrop\s+database\b/i.test(cmd);
}

function hasForcedGitPush(cmd: string): boolean {
  return (
    /\bgit\b[\s\S]*\bpush\b/i.test(cmd) &&
    /(^|[\s;&|])(-f\b|--force([=\s]|$)|--force-with-lease([=\s]|$))/i.test(cmd)
  );
}

function hasRecursiveForceRm(cmd: string): boolean {
  if (!/(^|[\s;&|])rm([\s;&|]|$)/i.test(cmd)) return false;
  const combined =
    /(^|[\s;&|])-[a-z]*r[a-z]*f[a-z]*(?=$|[\s;&|])|(^|[\s;&|])-[a-z]*f[a-z]*r[a-z]*(?=$|[\s;&|])/i;
  const recursive = /(^|[\s;&|])(-[a-z]*r[a-z]*|--recursive)(?=$|[\s;&|])/i;
  const force = /(^|[\s;&|])(-[a-z]*f[a-z]*|--force)(?=$|[\s;&|])/i;
  return combined.test(cmd) || (recursive.test(cmd) && force.test(cmd));
}

export function shellCommandAllowed(
  cmd: string,
): boolean {
  const trimmed = cmd.trim();
  if (!trimmed) return true;
  return !(hasDropDatabase(trimmed) || hasForcedGitPush(trimmed) || hasRecursiveForceRm(trimmed));
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

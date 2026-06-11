/**
 * CLI flag parsing, in its own module so it is testable — cli.ts executes
 * main() on import.
 */

/** Flags that never take a value. Without this list, `run --worktree "fix the
 *  bug"` would swallow the goal text as the flag's value and drive an empty
 *  goal — the exact documented invocation shape. */
export const BOOLEAN_FLAGS = new Set([
  "fast",
  "dry-run",
  "quiet",
  "worktree",
  "follow",
  "strict",
  "full",
  "stdout",
  "probe",
  "keep-evidence",
]);

export function parseFlags(args: string[]): {
  flags: Record<string, string | boolean>;
  rest: string[];
} {
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
      if (eq >= 0 && !BOOLEAN_FLAGS.has(name)) flags[name] = a.slice(eq + 1);
      else if (BOOLEAN_FLAGS.has(name)) flags[name] = true;
      else if (i + 1 < args.length && !args[i + 1].startsWith("--")) flags[name] = args[++i];
      else flags[name] = true;
    } else {
      rest.push(a);
    }
  }
  return { flags, rest };
}

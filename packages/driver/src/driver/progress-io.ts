/**
 * Live operator-facing progress for a run. The loop emits structured events;
 * the CLI renders them to stderr (stdout keeps its machine-readable contract).
 * Everything here is presentation over facts the loop already computes — the
 * journal stays the canonical record.
 */

export type ProgressEvent =
  | { kind: "decomposed"; tasks: number; source: string }
  | { kind: "goal_checks"; checks: string[] }
  | { kind: "turn_start"; turn: number; taskId: string; title: string; attempt: number; fresh: boolean }
  | {
      kind: "turn_end";
      turn: number;
      taskId: string;
      terminal: string;
      tokens: number;
      elapsedMs: number;
      decision: string;
      reason: string;
    }
  | { kind: "review"; round: number; material: number; satisfied: boolean; residual: boolean }
  | { kind: "remediation"; note: string }
  | { kind: "escalation"; reason: string }
  | { kind: "paused"; turns: number }
  | { kind: "done"; turns: number };

export type ProgressEmitter = (event: ProgressEvent) => void;

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k tok`;
  return `${n} tok`;
}

function fmtElapsed(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`;
}

function clip(s: string, max = 100): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

export function formatProgress(e: ProgressEvent): string {
  switch (e.kind) {
    case "decomposed":
      return `[plan] ${e.tasks} task(s) via ${e.source}`;
    case "goal_checks":
      return `[plan] PROPOSED goal checks (planner, no human checks given): ${e.checks.map((c) => `\`${c}\``).join("; ")}`;
    case "turn_start":
      return `[turn ${e.turn}] ${e.taskId} "${clip(e.title, 60)}" (attempt ${e.attempt}, ${e.fresh ? "fresh session" : "resume"})`;
    case "turn_end":
      return `[turn ${e.turn}] ${e.terminal} in ${fmtElapsed(e.elapsedMs)} · ${fmtTokens(e.tokens)} → ${e.decision}: ${clip(e.reason)}`;
    case "review":
      if (e.satisfied) return `[review ${e.round}] satisfied — shipping`;
      if (e.residual) return `[review ${e.round}] not converging — shipping with ${e.material} residual finding(s)`;
      return `[review ${e.round}] ${e.material} material finding(s) → remediation`;
    case "remediation":
      return `[remediate] ${clip(e.note)}`;
    case "escalation":
      return `[escalate] ${clip(e.reason, 160)}`;
    case "paused":
      return `[paused] after ${e.turns} turn(s) — continue with 'agent-driver resume'`;
    case "done":
      return `[done] ${e.turns} turn(s)`;
  }
}

/** One renderer for the per-category token breakdown — status and the run
 *  report must tell the same cost story. Empty string when nothing was spent. */
export function formatTokensByCategory(
  byCategory: Record<string, number> | undefined,
  separator = ", ",
): string {
  return Object.entries(byCategory ?? {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} ${v}`)
    .join(separator);
}

/** Default CLI sink. Never let a render problem touch the run. */
export function stderrProgress(e: ProgressEvent): void {
  try {
    process.stderr.write(`${formatProgress(e)}\n`);
  } catch {
    /* progress is best-effort */
  }
}

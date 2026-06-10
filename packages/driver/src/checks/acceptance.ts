import { runChecks, type CheckResult } from "../lib/checks.js";
import type { GoalSpec, Task } from "../state/schema.js";

export type AcceptanceOutcome = {
  results: CheckResult[];
  /** true when the task/goal has at least one machine check (objective decidability). */
  objective: boolean;
  allPass: boolean;
};

function summarize(results: CheckResult[], objective: boolean): AcceptanceOutcome {
  return {
    results,
    objective,
    allPass: objective && results.length > 0 && results.every((r) => r.ok),
  };
}

export async function runTaskAcceptance(root: string, task: Task): Promise<AcceptanceOutcome> {
  if (!task.acceptance_checks.length) return summarize([], false);
  const results = await runChecks(root, task.acceptance_checks, { useCache: true });
  return summarize(results, true);
}

export async function runGoalAcceptance(root: string, spec: GoalSpec): Promise<AcceptanceOutcome> {
  if (!spec.acceptance_checks.length) return summarize([], false);
  // goal-level acceptance is the authoritative stop gate — never serve it from cache
  const results = await runChecks(root, spec.acceptance_checks, { useCache: false });
  return summarize(results, true);
}

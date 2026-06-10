import { allPass, type CheckResult } from "../lib/checks.js";
import { noProgressExhausted } from "./progress.js";
import type { RunState, Task, Verdict } from "../state/schema.js";

export type DecisionKind =
  | "task_done"
  | "continue_same_session"
  | "replan"
  | "switch_approach"
  | "escalate";

export type Decision = {
  kind: DecisionKind;
  /** steering text fed into the next instruction (continue/switch). */
  instruction?: string;
  reason: string;
};

export type BudgetBreach = { breached: boolean; reason?: string };

/** Hard ceilings checked before every turn. Any breach stops the run. */
export function checkBudgets(run: RunState): BudgetBreach {
  if (run.global_turns >= run.budgets.global_turns) {
    return { breached: true, reason: `global turn budget exhausted (${run.budgets.global_turns})` };
  }
  if (run.consumed.tokens >= run.budgets.token_budget) {
    return { breached: true, reason: `token budget exhausted (${run.budgets.token_budget})` };
  }
  if (run.consumed.wall_ms >= run.budgets.wall_ms) {
    return { breached: true, reason: `wall-clock budget exhausted (${run.budgets.wall_ms}ms)` };
  }
  return { breached: false };
}

/**
 * Agent terminated abnormally (error/aborted/timeout). The agent's own claim of
 * completion is irrelevant here — this is the failure mode that bypassed the old
 * governor entirely. Climb the ladder by attempt count.
 */
export function onAgentFailure(run: RunState, task: Task): Decision {
  if (task.attempts >= run.budgets.task_attempts) {
    return {
      kind: "escalate",
      reason: `task ${task.id} failed ${task.attempts} times (agent error/abort); attempt budget exhausted`,
    };
  }
  return {
    kind: "switch_approach",
    instruction: "The previous turn ended abnormally. Take a smaller, safer first step.",
    reason: `agent terminal failure on ${task.id}; switching approach (attempt ${task.attempts})`,
  };
}

/**
 * Normal post-turn decision. Objective checks dominate: if acceptance passes and
 * the tree changed, the task is done regardless of what the model says. Otherwise
 * the strategy ladder selects retry -> replan -> switch -> escalate.
 */
export function decide(
  run: RunState,
  task: Task,
  checks: CheckResult[],
  verdict: Verdict,
  progressed: boolean,
  oscillating: boolean,
  integrity: { ok: boolean; issues: string[] } = { ok: true, issues: [] },
): Decision {
  const hasObjective = checks.length > 0;
  const objectivePass = hasObjective && allPass(checks);

  // Integrity gate: checks passing while verification was weakened or scope was
  // breached is the reward-hack / scope-creep signature. Never accept it; send the
  // agent back to undo it. This overrides an otherwise-passing turn.
  if (!integrity.ok) {
    if (task.attempts >= run.budgets.task_attempts) {
      return { kind: "escalate", reason: `integrity violation on ${task.id} unresolved: ${integrity.issues.join("; ")}` };
    }
    return {
      kind: "switch_approach",
      instruction: `Integrity violation — undo this and satisfy the task honestly: ${integrity.issues.join("; ")}. Do not weaken, skip, or delete verification, and stay within scope.`,
      reason: `integrity violation on ${task.id}: ${integrity.issues.join("; ")}`,
    };
  }

  // Objective completion: acceptance passed and work actually changed the tree.
  if (objectivePass && (progressed || task.attempts <= 1)) {
    return { kind: "task_done", reason: `acceptance checks pass for ${task.id}` };
  }

  // Verdict says complete, but only honor it when there are no contradicting checks.
  if (verdict.task_complete && !hasObjective) {
    return { kind: "task_done", reason: `verdict accepts ${task.id} (no machine checks; confidence ${verdict.confidence})` };
  }
  // If the model claims complete but objective checks fail, distrust the model.
  if (verdict.task_complete && hasObjective && !objectivePass) {
    // fall through to ladder — the checks are the source of truth
  }

  // Attempt budget: escalate this task.
  if (task.attempts >= run.budgets.task_attempts) {
    return { kind: "escalate", reason: `task ${task.id} attempt budget exhausted (${task.attempts})` };
  }

  // Oscillation: undoing/redoing — never retry the same way.
  if (oscillating) {
    return {
      kind: "switch_approach",
      instruction: verdict.next_action.instruction || "You are oscillating. Commit to one approach and finish it.",
      reason: `oscillation detected on ${task.id}`,
    };
  }

  // No progress across the streak limit: escalate strategy (replan or switch).
  if (noProgressExhausted(run)) {
    if (verdict.next_action.kind === "replan") {
      return { kind: "replan", reason: `no progress on ${task.id}; replanning` };
    }
    return {
      kind: "switch_approach",
      instruction: verdict.next_action.instruction || "No progress — change tactics entirely.",
      reason: `no-progress streak on ${task.id}; switching approach`,
    };
  }

  // Honor the verdict's chosen next action.
  switch (verdict.next_action.kind) {
    case "replan":
      return { kind: "replan", reason: `verdict requests replan of ${task.id}` };
    case "switch_approach":
      return {
        kind: "switch_approach",
        instruction: verdict.next_action.instruction,
        reason: `verdict requests switch on ${task.id}`,
      };
    case "escalate":
      return { kind: "escalate", reason: `verdict escalates ${task.id}: ${verdict.blockers.join("; ")}` };
    case "continue":
    case "none":
    default:
      return {
        kind: "continue_same_session",
        instruction:
          verdict.next_action.instruction ||
          "Continue toward the acceptance checks; fix the remaining failures.",
        reason: `continue ${task.id} (attempt ${task.attempts})`,
      };
  }
}

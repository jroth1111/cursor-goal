import type { ContextWindow } from "./context-window.js";
import type { GoalSpec, Task } from "../state/schema.js";
import { PREVIEW, formatFailureForPrompt } from "../lib/progressive-reveal.js";

function acceptanceBlock(task: Task): string {
  const lines: string[] = [];
  if (task.acceptance_checks.length) {
    lines.push("This task is accepted when ALL of these commands exit 0:");
    for (const c of task.acceptance_checks) lines.push(`  - \`${c}\``);
  }
  if (task.acceptance_prose.trim()) {
    lines.push(`Acceptance (prose): ${task.acceptance_prose.trim()}`);
  }
  return lines.join("\n");
}

function historyBlock(ctx: ContextWindow): string {
  if (!ctx.attempts.length && !ctx.last_failure) return "";
  const lines: string[] = ["", "What has already been tried (do not repeat failed approaches):"];
  const recent = ctx.attempts.slice(-PREVIEW.HISTORY_ATTEMPTS);
  const omitted = ctx.attempts.length - recent.length;
  for (const a of recent) {
    const fails = a.check_fails.length ? ` — failed: ${a.check_fails.join(", ")}` : "";
    lines.push(`  - turn ${a.turn} [${a.terminal}] ${a.instruction_summary}${fails}`);
  }
  if (omitted > 0) {
    lines.push(`  - (${omitted} earlier attempt(s) omitted; see .cursor/goal/driver/context/${ctx.task_id}.json)`);
  }
  if (ctx.last_failure) {
    lines.push(
      "",
      "Most recent failure detail:",
      formatFailureForPrompt(ctx.last_failure, ctx.last_failure_artifact || undefined),
    );
  }
  if (ctx.open_blockers.length) {
    lines.push("", `Open blockers: ${ctx.open_blockers.join("; ")}`);
  }
  return lines.join("\n");
}

/**
 * Build the per-turn instruction. On a resumed session the server already holds
 * the conversation, so this injects only the goal anchor, the task's acceptance,
 * the steering delta, and (when present) an explicit next-step from the verdict.
 */
export function buildInstruction(
  spec: GoalSpec,
  task: Task,
  ctx: ContextWindow,
  nextStep: string | null,
  isFreshSession: boolean,
): string {
  const lines: string[] = [];
  lines.push(`GOAL: ${spec.goal_text}`);
  lines.push(`CURRENT TASK (${task.id}): ${task.title}`);
  const accept = acceptanceBlock(task);
  if (accept) lines.push(accept);
  if (task.approach && task.approach !== "default") {
    lines.push(`Use this approach: ${task.approach}`);
  }
  const history = historyBlock(ctx);
  if (history) lines.push(history);
  if (nextStep) {
    lines.push("", `Next step: ${nextStep}`);
  } else if (isFreshSession) {
    lines.push("", "Make focused edits toward this task's acceptance, then stop.");
  } else {
    lines.push("", "Continue toward this task's acceptance. Address the failure above, then stop.");
  }
  lines.push(
    "",
    "Aim for production quality, not the minimum that passes a check: handle edge and failure",
    "cases (empty/boundary/malformed/oversized input, clear error paths), and write tests that",
    "exercise the real entry point (CLI/API/real I/O) and assert user-visible behavior — not",
    "mocks of your own code or internal details. Keep the code clear. Stay within the goal's",
    "scope. Do not commit. When you believe the task is complete, stop and say so.",
  );
  return lines.join("\n");
}

export function summarizeInstruction(instruction: string): string {
  const taskLine = instruction.split("\n").find((l) => l.startsWith("CURRENT TASK"));
  return taskLine ?? instruction.split("\n")[0] ?? "";
}

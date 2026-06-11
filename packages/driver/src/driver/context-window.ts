import { atomicWriteJson, contextPath, readJson } from "../lib/paths.js";

/**
 * Per-task accumulated context. This is the cure for the old system's context
 * starvation: instead of re-injecting nothing, the driver carries forward what
 * was tried and why it failed, and feeds the delta into the next instruction.
 */
export type ContextWindow = {
  task_id: string;
  attempts: AttemptRecord[];
  tried_approaches: string[];
  open_blockers: string[];
  last_failure: string;
  /** Relative path to the full last_failure payload when it was spilled to evidence/. */
  last_failure_artifact: string;
  /** steering instruction for the next turn, set by the prior turn's decision. */
  next_step: string;
  /** Notes injected by the human via `agent-driver steer` (most recent last).
   *  Rendered above model steering in the instruction — the human outranks the
   *  model — and survives switch_approach because context outlives sessions. */
  operator_guidance: Array<{ at: string; text: string }>;
};

export type AttemptRecord = {
  turn: number;
  instruction_summary: string;
  terminal: string;
  check_fails: string[];
  diff_stat: string;
};

export function emptyContext(taskId: string): ContextWindow {
  return {
    task_id: taskId,
    attempts: [],
    tried_approaches: [],
    open_blockers: [],
    last_failure: "",
    last_failure_artifact: "",
    next_step: "",
    operator_guidance: [],
  };
}

export async function loadContext(root: string, taskId: string): Promise<ContextWindow> {
  const ctx = (await readJson<ContextWindow>(contextPath(root, taskId))) ?? emptyContext(taskId);
  ctx.last_failure_artifact ??= "";
  ctx.operator_guidance ??= []; // context files written before steer existed
  return ctx;
}

export async function saveContext(root: string, ctx: ContextWindow): Promise<void> {
  await atomicWriteJson(contextPath(root, ctx.task_id), ctx);
}

export function recordAttempt(ctx: ContextWindow, attempt: AttemptRecord): void {
  ctx.attempts.push(attempt);
}

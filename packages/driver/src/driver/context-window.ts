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
  /** steering instruction for the next turn, set by the prior turn's decision. */
  next_step: string;
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
    next_step: "",
  };
}

export async function loadContext(root: string, taskId: string): Promise<ContextWindow> {
  return (await readJson<ContextWindow>(contextPath(root, taskId))) ?? emptyContext(taskId);
}

export async function saveContext(root: string, ctx: ContextWindow): Promise<void> {
  await atomicWriteJson(contextPath(root, ctx.task_id), ctx);
}

export function recordAttempt(ctx: ContextWindow, attempt: AttemptRecord): void {
  ctx.attempts.push(attempt);
  // keep the window bounded; the server holds full history via --resume
  if (ctx.attempts.length > 10) ctx.attempts = ctx.attempts.slice(-10);
}

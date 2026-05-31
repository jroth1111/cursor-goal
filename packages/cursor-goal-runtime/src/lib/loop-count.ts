import { projectRoot } from "./paths.js";
import { readAgentLoopCount, readAgentRuntimeState } from "./agent-runtime-state.js";
import { readLoopLimit } from "./loop-limit.js";
import type { StopInput } from "../verifier/types.js";
import type { VerifierContext } from "../verifier/types.js";
import type { RuntimeStateFile } from "./runtime-state.js";
import {
  readPersistedLoopCount,
  recordBlockedStop,
  resetLoopCount as resetRuntimeLoopCount,
} from "./runtime-state.js";

/**
 * Agent blocked-loop counter (per conversation).
 * Increments on each blocked stop for that agent — independent of Cursor's agent stop index.
 */
export async function resolveGoalBlockedLoopCount(
  root?: string,
  agentId?: string,
): Promise<number> {
  return readPersistedLoopCount(root ?? projectRoot(), agentId);
}

/** Cursor stop hook may pass loop_count (agent turn index). Used only for disposition budget. */
export function cursorStopLoopFromInput(input: StopInput): number | null {
  const n = input.loop_count;
  if (typeof n === "number" && n >= 0) return n;
  return null;
}

/**
 * Loop index for disposition threshold (per agent).
 * Uses max(agent blocked attempts, Cursor stop index).
 */
export function budgetLoopCount(ctx: VerifierContext): number {
  const goal = ctx.loopCount;
  const cursor = cursorStopLoopFromInput(ctx.input);
  if (cursor === null) return goal;
  return Math.max(goal, cursor);
}

/** @deprecated use resolveGoalBlockedLoopCount — do not sync Cursor loop_count into goal counter */
export async function resolveLoopCount(input: StopInput, root?: string): Promise<number> {
  void input;
  return resolveGoalBlockedLoopCount(root);
}

export type IncrementLoopOptions = {
  /** When false, caller writes full runtime-state after increment. Default true. */
  persist?: boolean;
  blocked?: boolean;
  agentId?: string;
};

/**
 * @deprecated Prefer `recordBlockedStop` from `./runtime-state.js`.
 * When `persist` is true, uses `recordBlockedStop` (single lock).
 */
export async function incrementLoopCount(
  root?: string,
  fromCount?: number,
  options: IncrementLoopOptions = {},
): Promise<number> {
  const r = root ?? projectRoot();
  const agentId = options.agentId ?? "default";
  const base =
    typeof fromCount === "number" ? fromCount : await readAgentLoopCount(r, agentId);
  const next = base + 1;
  if (options.persist === false) {
    return next;
  }
  const { agentLoop } = await recordBlockedStop(
    r,
    agentId,
    base,
    await minimalBlockedState(r, agentId, next, options.blocked ?? true),
  );
  return agentLoop;
}

async function minimalBlockedState(
  root: string,
  agentId: string,
  loopCount: number,
  blocked: boolean,
): Promise<RuntimeStateFile> {
  const limit = await readLoopLimit(root);
  const existing = (await readAgentRuntimeState(root, agentId)) ?? {
    mode: "runtime" as const,
    loop_count: 0,
    loop_limit: limit,
    phase: "DISCOVERY",
    blocked: false,
    blockers: [],
    next_action: null,
    last_check_fail: null,
    updated_at: new Date().toISOString(),
  };
  return {
    ...existing,
    loop_count: loopCount,
    loop_limit: limit,
    blocked,
    updated_at: new Date().toISOString(),
  };
}

export async function resetLoopCount(
  root?: string,
  releasingAgentId?: string,
  releasedState?: RuntimeStateFile,
): Promise<void> {
  await resetRuntimeLoopCount(root ?? projectRoot(), releasingAgentId, releasedState);
}

export { readPersistedLoopCount };
export { readRepoBlockedStopTotal } from "./goal-loop.js";

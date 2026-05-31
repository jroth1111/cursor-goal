import { projectRoot } from "./paths.js";
import type { StopInput } from "../verifier/types.js";
import type { VerifierContext } from "../verifier/types.js";
import type { RuntimeStateFile } from "./runtime-state.js";
import {
  readPersistedLoopCount,
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

export async function resetLoopCount(
  root?: string,
  releasingAgentId?: string,
  releasedState?: RuntimeStateFile,
): Promise<void> {
  await resetRuntimeLoopCount(root ?? projectRoot(), releasingAgentId, releasedState);
}

export { readPersistedLoopCount };
export { readRepoBlockedStopTotal } from "./goal-loop.js";

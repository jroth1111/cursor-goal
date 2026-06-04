import type { Phase } from "../trajectory/fsm.js";
import type { VerifierContext } from "../verifier/types.js";
import { buildStopAlignedContext } from "./stop-aligned-context.js";

export type LiveBlockedResult = {
  blocked: boolean;
  ctx: VerifierContext;
  phase: Phase;
};

/** Fresh verifier evaluation without persisted agent handoff (operator / nested stop). */
export async function evaluateLiveBlocked(root: string): Promise<LiveBlockedResult> {
  const { blocked, ctx, phase } = await buildStopAlignedContext(root, {
    loop_count: 0,
  });
  return { blocked, ctx, phase: phase as Phase };
}

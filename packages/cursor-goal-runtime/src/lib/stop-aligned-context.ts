import { existsSync } from "node:fs";
import { readRepoBlockedStopTotal } from "./goal-loop.js";
import { readLoopLimit } from "./loop-limit.js";
import { loadCompiledGoal } from "./compiled-goal.js";
import { gitTreeId } from "./git-state.js";
import { readAgentLoopCount } from "./agent-runtime-state.js";
import { resolveAgentId, type AgentIdSource } from "./runtime-state.js";
import { sessionEndMarkerPath } from "./disposition.js";
import { maybeAutoAdvanceToVerify, readTrajectory, type Phase } from "../trajectory/fsm.js";
import type { StopInput, VerifierContext } from "../verifier/types.js";
import {
  levelChecksPass,
  runFullTierChecksBeforeRelease,
} from "../verifier/l3-checks-pass.js";
import { levelScope } from "../verifier/l4-scope.js";
import { levelForbiddenProxy } from "../verifier/l5-forbidden-proxy.js";
import { levelFreshProofBlocked } from "../verifier/l6-fresh-proof.js";
import { levelWorkUnitsBlocked } from "../verifier/l-work-units.js";
import { levelTrajectoryBlocked } from "../verifier/l-trajectory.js";
import { levelChecksPresent } from "../verifier/l2-checks-present.js";
import { levelContract } from "../verifier/l1-contract.js";
import {
  levelDeliverableCoherence,
  levelIntentStructure,
  levelInvalidators,
} from "../verifier/invalidators.js";
import { levelProofPlanAdvisory } from "../verifier/l5b-proof-plan-advisory.js";
import { levelAdversarialBlocked } from "../verifier/l-adversarial.js";

export type StopAlignedContextOptions = AgentIdSource & {
  /** Override loop count (e.g. CLI verify passes loop_count: 0). */
  loop_count?: number;
};

export type StopAlignedContext = {
  ctx: VerifierContext;
  blocked: boolean;
  phase: Phase;
};

/** Build verifier context aligned with stop-hook release blockers (read-only for `next`). */
export async function buildStopAlignedContext(
  root: string,
  options?: StopAlignedContextOptions,
): Promise<StopAlignedContext> {
  const agentId = resolveAgentId(options);
  const compiled = await loadCompiledGoal(root);
  if (!compiled.ok) {
    throw new Error(compiled.message);
  }
  const parsed = compiled.parsed;
  const loopCount =
    typeof options?.loop_count === "number"
      ? options.loop_count
      : agentId
        ? await readAgentLoopCount(root, agentId)
        : await readRepoBlockedStopTotal(root);

  const input: StopInput = {
    status: "completed",
    conversation_id: options?.conversation_id,
    loop_count: options?.loop_count,
  };

  const ctx: VerifierContext = {
    root,
    input,
    parsed,
    loopLimit: await readLoopLimit(root),
    loopCount,
    failures: [],
    checkResults: [],
    currentTree: gitTreeId(root),
    phaseBlocked: false,
    unitsBlocked: false,
  };

  const contract = levelContract(ctx);
  if (contract.halt) ctx.failures.push("contract:missing-goal");

  const checksPresent = levelChecksPresent(ctx);
  if (checksPresent.halt) {
    ctx.failures.push("checks:empty");
    if (checksPresent.message) ctx.followupMessage = checksPresent.message;
  }

  await levelScope(ctx);
  levelForbiddenProxy(ctx);
  levelIntentStructure(ctx);
  await levelChecksPass(ctx);
  await levelFreshProofBlocked(ctx);
  ctx.advisoryWarnings = await levelProofPlanAdvisory(ctx);

  if (existsSync(sessionEndMarkerPath(root))) {
    ctx.failures.push("SESSION_END");
  }

  ctx.unitsBlocked = await levelWorkUnitsBlocked(ctx);
  const traj = await readTrajectory(root);
  const advanced = ctx.unitsBlocked
    ? null
    : await maybeAutoAdvanceToVerify(ctx.root, { dryRun: true });
  const phaseGate = await levelTrajectoryBlocked(ctx);
  ctx.phaseBlocked = advanced === "VERIFY" ? false : phaseGate.blocked;
  ctx.phase = advanced ?? traj.phase;

  const inv = await levelInvalidators(ctx);
  if (inv.halt && inv.message) ctx.followupMessage = inv.message;

  const del = await levelDeliverableCoherence(ctx);
  if (del.halt && del.message && !ctx.followupMessage) ctx.followupMessage = del.message;

  let blocked = ctx.failures.length > 0 || ctx.unitsBlocked || ctx.phaseBlocked;

  if (!blocked) {
    const adv = await levelAdversarialBlocked(ctx);
    if (adv.blocked) {
      blocked = true;
      if (adv.message) ctx.followupMessage = adv.message;
    }
  }

  if (!blocked) {
    await runFullTierChecksBeforeRelease(ctx);
    blocked = ctx.failures.length > 0 || ctx.unitsBlocked || ctx.phaseBlocked;
  }

  return { ctx, blocked, phase: (ctx.phase ?? traj.phase) as Phase };
}

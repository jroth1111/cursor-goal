import { existsSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import nodePath from "node:path";
import { ensureGoalDirs, goalDir, goalMd, projectRoot } from "../lib/paths.js";
import { parseGoalMd } from "../lib/parse-goal-md.js";
import { gitTreeId } from "../lib/git-state.js";
import { readLoopLimit } from "../lib/loop-limit.js";
import {
  computeRuntimeState,
  formatDispositionMessage,
  formatFollowupMessage,
  releaseRuntimeState,
  resolveAgentId,
  writeUnblockedContinueState,
} from "../lib/runtime-state.js";
import { cursorStopLoopFromInput } from "../lib/loop-count.js";
import { resolveGoalBlockedLoopCount } from "../lib/loop-count.js";
import { recordBlockedStop } from "../lib/runtime-state.js";
import { maybeAutoAdvanceToVerify } from "../trajectory/fsm.js";
import { levelPaused } from "./l0-paused.js";
import { levelContract } from "./l1-contract.js";
import { levelChecksPresent } from "./l2-checks-present.js";
import { levelChecksPass } from "./l3-checks-pass.js";
import { levelScope } from "./l4-scope.js";
import { levelForbiddenProxy } from "./l5-forbidden-proxy.js";
import { levelFreshProofBlocked, levelFreshProofOnRelease } from "./l6-fresh-proof.js";
import {
  dispositionForLoop,
  resolveLoopBudgetMessage,
} from "./l7-loop-budget.js";
import { levelWorkUnitsBlocked } from "./l-work-units.js";
import { levelTrajectoryBlocked } from "./l-trajectory.js";
import {
  levelDeliverableCoherence,
  levelIntentStructure,
  levelInvalidators,
} from "./invalidators.js";
import type { StopInput, VerifyKind, VerifierContext } from "./types.js";

export type VerifyResult =
  | { kind: "release" }
  | { kind: "continue"; message: string }
  | { kind: "disposition"; failed: string[]; message: string }
  | { kind: "idle" };

function wrap(
  ctx: VerifierContext,
  r: { halt?: boolean; kind?: VerifyKind; message?: string },
): VerifyResult | null {
  if (!r.halt || !r.kind) return null;
  if (r.kind === "continue" && r.message) return { kind: "continue", message: r.message };
  if (r.kind === "idle") return { kind: "idle" };
  if (r.kind === "disposition") {
    return {
      kind: "disposition",
      failed: [...ctx.failures],
      message: r.message ?? "Disposition — see .cursor/goal/passports/DISPOSITION.md",
    };
  }
  return { kind: "idle" };
}

async function finishEarly(
  root: string,
  result: VerifyResult,
  agentId: string,
  ctx?: VerifierContext,
): Promise<VerifyResult> {
  if (result.kind === "continue") {
    await writeUnblockedContinueState(root, {
      loopCount: ctx?.loopCount,
      agentId,
    });
  }
  return result;
}

export async function runStopPipeline(input: StopInput): Promise<VerifyResult> {
  const root = projectRoot();
  const agentId = resolveAgentId(input);
  await ensureGoalDirs(root);

  if (!existsSync(goalMd(root))) {
    await writeUnblockedContinueState(root, { agentId });
    return {
      kind: "continue",
      message:
        "GOAL.md is missing. Create it from .cursor/goal/templates/GOAL.md with ## Checks.",
    };
  }

  const parsed = await parseGoalMd(root);
  const loopCount = await resolveGoalBlockedLoopCount(root, agentId);
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

  let early = wrap(ctx, levelPaused(ctx));
  if (early) return finishEarly(root, early, agentId, ctx);

  early = wrap(ctx, levelContract(ctx));
  if (early) return finishEarly(root, early, agentId, ctx);

  early = wrap(ctx, levelChecksPresent(ctx));
  if (early) return finishEarly(root, early, agentId, ctx);

  levelScope(ctx);
  levelForbiddenProxy(ctx);
  levelIntentStructure(ctx);
  await levelChecksPass(ctx);
  await levelFreshProofBlocked(ctx);

  ctx.unitsBlocked = await levelWorkUnitsBlocked(ctx);
  const advanced = await maybeAutoAdvanceToVerify(ctx.root);
  const traj = await levelTrajectoryBlocked(ctx);
  ctx.phaseBlocked = traj.blocked;
  ctx.phase = advanced ?? traj.phase;

  const inv = await levelInvalidators(ctx);
  if (inv.halt && inv.message) ctx.followupMessage = inv.message;

  const del = await levelDeliverableCoherence(ctx);
  if (del.halt && del.message && !ctx.followupMessage) ctx.followupMessage = del.message;

  const blocked =
    ctx.failures.length > 0 || ctx.unitsBlocked || ctx.phaseBlocked;

  if (!blocked) {
    ctx.loopCount = 0;
    await levelFreshProofOnRelease(ctx);
    const releasedState = await computeRuntimeState({
      ctx,
      phase: ctx.phase,
      phaseBlocked: false,
      unitsBlocked: false,
      blocked: false,
    });
    await releaseRuntimeState(root, agentId, releasedState, {
      status: "RELEASE",
      at: new Date().toISOString(),
      mode: "runtime",
      loop_count: 0,
      conversation_id: input.conversation_id,
      proof_tree: ctx.currentTree,
      checks: ctx.parsed.checks,
    });
    return { kind: "release" };
  }

  await appendProgress(ctx);
  const nextLoop = ctx.loopCount + 1;
  const runtimeState = await computeRuntimeState({
    ctx: { ...ctx, loopCount: nextLoop },
    phase: ctx.phase,
    phaseBlocked: ctx.phaseBlocked,
    unitsBlocked: ctx.unitsBlocked,
    blocked: true,
  });
  const budgetCtx = { ...ctx, loopCount: nextLoop };
  const followup = await resolveLoopBudgetMessage(budgetCtx, runtimeState);
  const { agentLoop, repoTotal, dispositionWritten } = await recordBlockedStop(
    root,
    agentId,
    ctx.loopCount,
    runtimeState,
    {
      dispositionForLoop: (loop) => dispositionForLoop(budgetCtx, followup, loop),
    },
  );
  ctx.loopCount = agentLoop;

  if (dispositionWritten) {
    const persistedState = { ...runtimeState, loop_count: agentLoop };
    return {
      kind: "disposition",
      failed: [...ctx.failures],
      message: formatDispositionMessage(
        persistedState,
        cursorStopLoopFromInput(input),
        repoTotal,
        agentId,
      ),
    };
  }

  return {
    kind: "continue",
    message:
      ctx.followupMessage ??
      formatFollowupMessage(
        { ...runtimeState, loop_count: agentLoop },
        cursorStopLoopFromInput(input),
        repoTotal,
        agentId,
      ),
  };
}

async function appendProgress(ctx: VerifierContext): Promise<void> {
  const progress = nodePath.join(goalDir(ctx.root), "PROGRESS.md");
  const line = `\n## ${new Date().toISOString()} stop-blocked\n- failures: ${ctx.failures.join("; ") || "none"}\n- phase_blocked: ${ctx.phaseBlocked}\n- units_blocked: ${ctx.unitsBlocked}\n`;
  await appendFile(progress, line, "utf8").catch(() => undefined);
}

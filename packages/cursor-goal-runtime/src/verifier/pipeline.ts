import { existsSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import nodePath from "node:path";
import { ensureGoalDirs, goalDir, goalMd, projectRoot } from "../lib/paths.js";
import { loadCompiledGoal } from "../lib/compiled-goal.js";
import { gitTreeId } from "../lib/git-state.js";
import { readLoopLimit } from "../lib/loop-limit.js";
import {
  computeRuntimeState,
  formatDispositionMessage,
  formatFollowupMessage,
  honorExistingReleasePassport,
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
import { levelProofPlanAdvisory } from "./l5b-proof-plan-advisory.js";
import { levelAdversarialBlocked } from "./l-adversarial.js";
import { appendStopTrace, readStopTraceTail } from "../lib/stop-trace.js";
import { readPromptContext } from "../lib/prompt-context.js";
import { readTranscriptTailEvidence } from "../lib/transcript-tail.js";
import {
  computeSignatureFromContext,
  detectOscillation,
  detectTokenStagnation,
  readStopSignatureTail,
  recordStopSignature,
} from "../lib/stop-signature.js";
import { oscillationSteeringBlurb } from "../lib/followup-steering.js";
import type { StopInput, VerifyKind, VerifierContext, PipelineOptions } from "./types.js";

export function governanceFollowupMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.startsWith("[governance]")) return trimmed;
  return `[governance] ${trimmed}`;
}

export type VerifyResult =
  | { kind: "release" }
  | { kind: "continue"; message: string }
  | { kind: "disposition"; failed: string[]; message: string }
  | { kind: "idle" };

export type StopDiagnostics = {
  result: VerifyResult;
  ctx: VerifierContext;
};

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
  options?: PipelineOptions,
): Promise<VerifyResult> {
  if (options?.dryRun) return result;
  if (result.kind === "continue") {
    await writeUnblockedContinueState(root, {
      loopCount: ctx?.loopCount,
      agentId,
    });
  }
  return result;
}

export async function runStopPipeline(
  input: StopInput,
  options?: PipelineOptions,
): Promise<VerifyResult> {
  const root = projectRoot();
  const agentId = resolveAgentId(input);
  const dryRun = options?.dryRun === true;
  await ensureGoalDirs(root);
  const promptContext = await readPromptContext(root, agentId).catch(() => null);

  if (!existsSync(goalMd(root))) {
    if (!dryRun) await writeUnblockedContinueState(root, { agentId });
    return { kind: "idle" };
  }

  const compiled = await loadCompiledGoal(root);
  if (!compiled.ok) {
    if (!dryRun) {
      await appendStopTrace(root, {
        at: new Date().toISOString(),
        agent_id: agentId,
        level_failed: "compiled-contract",
        failures: [compiled.message],
        pipeline_result: "continue",
        terminal_status: input.status ?? "unknown",
      }).catch(() => undefined);
    }
    return { kind: "continue", message: governanceFollowupMessage(compiled.message) };
  }
  const parsed = compiled.parsed;
  const honorPassport = !dryRun && (await honorExistingReleasePassport(root));
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
  if (early) return finishEarly(root, early, agentId, ctx, options);

  early = wrap(ctx, levelContract(ctx));
  if (early) return finishEarly(root, early, agentId, ctx, options);

  early = wrap(ctx, levelChecksPresent(ctx));
  if (early) return finishEarly(root, early, agentId, ctx, options);

  await levelScope(ctx);
  levelForbiddenProxy(ctx);
  levelIntentStructure(ctx);
  await levelChecksPass(ctx);
  const { enrichOrchestratorFollowup } = await import("../lib/orchestrator.js");
  await enrichOrchestratorFollowup(ctx);
  await levelFreshProofBlocked(ctx);
  ctx.advisoryWarnings = await levelProofPlanAdvisory(ctx);

  ctx.unitsBlocked = await levelWorkUnitsBlocked(ctx);
  const advanced = ctx.unitsBlocked
    ? null
    : await maybeAutoAdvanceToVerify(ctx.root, { dryRun });
  const traj = await levelTrajectoryBlocked(ctx);
  ctx.phaseBlocked = advanced === "VERIFY" ? false : traj.blocked;
  ctx.phase = advanced ?? traj.phase;

  const inv = await levelInvalidators(ctx);
  if (inv.halt && inv.message) ctx.followupMessage = inv.message;

  const del = await levelDeliverableCoherence(ctx);
  if (del.halt && del.message && !ctx.followupMessage) ctx.followupMessage = del.message;

  let blocked =
    ctx.failures.length > 0 || ctx.unitsBlocked || ctx.phaseBlocked;

  if (!blocked) {
    const adv = await levelAdversarialBlocked(ctx);
    if (adv.blocked) {
      blocked = true;
      if (adv.message) ctx.followupMessage = adv.message;
    }
  }

  if (!blocked) {
    const { runFullTierChecksBeforeRelease } = await import("./l3-checks-pass.js");
    await runFullTierChecksBeforeRelease(ctx);
    blocked =
      ctx.failures.length > 0 || ctx.unitsBlocked || ctx.phaseBlocked;
  }

  const levelFailed =
    ctx.failures[0]?.startsWith("adversarial")
      ? "L-adversarial"
      : ctx.failures.some((f) => ctx.checkResults.some((c) => !c.ok && c.cmd === f))
        ? "L3"
        : ctx.failures[0]?.startsWith("stale-proof")
          ? "L6"
          : ctx.failures.length
            ? "L-other"
            : null;
  const signature = blocked ? computeSignatureFromContext(ctx, levelFailed) : undefined;
  let repeatedSignatureCount = 0;

  if (!dryRun) {
    if (blocked && signature) {
      repeatedSignatureCount = await recordStopSignature(ctx.root, agentId, signature);
    }
    const transcriptTail = await readTranscriptTailEvidence(input.transcript_path).catch(() => undefined);
    const hasTokens = input.input_tokens != null || input.output_tokens != null;
    await appendStopTrace(ctx.root, {
      at: new Date().toISOString(),
      agent_id: agentId,
      ...(signature ? { signature } : {}),
      level_failed: levelFailed,
      failures: [...ctx.failures],
      pipeline_result: blocked ? "continue" : "release",
      terminal_status: input.status ?? "unknown",
      honor_passport: honorPassport && !blocked,
      ...(transcriptTail ? { transcript_tail: transcriptTail } : {}),
      ...(hasTokens ? {
        token_usage: {
          input_tokens: input.input_tokens,
          output_tokens: input.output_tokens,
          cache_read_tokens: input.cache_read_tokens,
          cache_write_tokens: input.cache_write_tokens,
        },
      } : {}),
    }).catch(() => undefined);

    // Oscillation detection — replace generic followup when agent is cycling.
    if (blocked && !ctx.followupMessage) {
      try {
        const sigTail = await readStopSignatureTail(ctx.root, agentId, 5);
        const osc = detectOscillation(sigTail);
        const traces = await readStopTraceTail(ctx.root, 5);
        const stagnant = detectTokenStagnation(traces);
        if (osc) {
          ctx.followupMessage = oscillationSteeringBlurb(osc.signatures);
        } else if (stagnant) {
          ctx.followupMessage =
            "Token usage growing but checks not improving. Re-read failure output and address root cause instead of re-running.";
        }
      } catch {
        /* oscillation detection is advisory — fail-open */
      }
    }
  }

  if (!blocked) {
    if (dryRun) return { kind: "release" };
    ctx.loopCount = 0;
    await levelFreshProofOnRelease(ctx);
    const releasedState = await computeRuntimeState({
      ctx,
      phase: ctx.phase,
      phaseBlocked: false,
      unitsBlocked: false,
      blocked: false,
      promptContext,
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

  if (input.stop_hook_active === true) {
    const disposition = dispositionForLoop(
      ctx,
      ctx.followupMessage ?? "Checks still failing.",
      ctx.loopCount,
      repeatedSignatureCount,
    );
    if (disposition) {
      const runtimeState = await computeRuntimeState({
        ctx,
        phase: ctx.phase,
        phaseBlocked: ctx.phaseBlocked,
        unitsBlocked: ctx.unitsBlocked,
        blocked: true,
        promptContext,
      });
      const { agentLoop, repoTotal } = await recordBlockedStop(
        root,
        agentId,
        ctx.loopCount,
        runtimeState,
        { disposition },
      );
      return {
        kind: "disposition",
        failed: [...ctx.failures],
        message: formatDispositionMessage(
          { ...runtimeState, loop_count: agentLoop },
          cursorStopLoopFromInput(input),
          repoTotal,
          agentId,
          repeatedSignatureCount >= 3 ? "repeated_failure" : "budget",
        ),
      };
    }
    const hasCheckFailure =
      ctx.failures.length > 0 &&
      ctx.failures.some((f) => ctx.checkResults.some((c) => !c.ok && c.cmd === f));
    const hasNonCheckFailure = ctx.failures.some(
      (f) => !ctx.checkResults.some((c) => !c.ok && c.cmd === f),
    );
    if (hasCheckFailure && !hasNonCheckFailure && !ctx.unitsBlocked) {
      return { kind: "idle" };
    }
    return {
      kind: "continue",
      message: governanceFollowupMessage(
        ctx.followupMessage ??
          "Prior stop followup may be stale; re-run cursor-goal next and fix the current blocker before relying on an older queued prompt.",
      ),
    };
  }

  if (dryRun) {
    const nextLoop = ctx.loopCount + 1;
    const runtimeState = await computeRuntimeState({
      ctx: { ...ctx, loopCount: nextLoop },
      phase: ctx.phase,
      phaseBlocked: ctx.phaseBlocked,
      unitsBlocked: ctx.unitsBlocked,
      blocked: true,
      promptContext,
    });
    const budgetCtx = { ...ctx, loopCount: nextLoop };
    const followup = await resolveLoopBudgetMessage(budgetCtx, runtimeState);
    const disposition = dispositionForLoop(budgetCtx, followup, nextLoop, repeatedSignatureCount);
    if (disposition) {
      return {
        kind: "disposition",
        failed: [...ctx.failures],
        message: disposition.mdBody ?? followup,
      };
    }
    return {
      kind: "continue",
      message: governanceFollowupMessage(ctx.followupMessage ?? followup),
    };
  }

  await appendProgress(ctx);
  const nextLoop = ctx.loopCount + 1;
  const runtimeState = await computeRuntimeState({
    ctx: { ...ctx, loopCount: nextLoop },
    phase: ctx.phase,
    phaseBlocked: ctx.phaseBlocked,
    unitsBlocked: ctx.unitsBlocked,
    blocked: true,
    promptContext,
  });
  const budgetCtx = { ...ctx, loopCount: nextLoop };
  const followup = await resolveLoopBudgetMessage(budgetCtx, runtimeState);
  const { agentLoop, repoTotal, dispositionWritten } = await recordBlockedStop(
    root,
    agentId,
    ctx.loopCount,
    runtimeState,
    {
      dispositionForLoop: (loop) =>
        dispositionForLoop(budgetCtx, followup, loop, repeatedSignatureCount),
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
        repeatedSignatureCount >= 3 ? "repeated_failure" : "budget",
      ),
    };
  }

  return {
    kind: "continue",
    message: governanceFollowupMessage(
      ctx.followupMessage ??
        formatFollowupMessage(
          { ...runtimeState, loop_count: agentLoop },
          cursorStopLoopFromInput(input),
          repoTotal,
          agentId,
        ),
    ),
  };
}

async function appendProgress(ctx: VerifierContext): Promise<void> {
  const progress = nodePath.join(goalDir(ctx.root), "PROGRESS.md");
  const advisory =
    ctx.advisoryWarnings?.length ? `\n- advisory: ${ctx.advisoryWarnings.join("; ")}` : "";
  const line = `\n## ${new Date().toISOString()} stop-blocked\n- failures: ${ctx.failures.join("; ") || "none"}\n- phase_blocked: ${ctx.phaseBlocked}\n- units_blocked: ${ctx.unitsBlocked}${advisory}\n`;
  await appendFile(progress, line, "utf8").catch(() => undefined);
}

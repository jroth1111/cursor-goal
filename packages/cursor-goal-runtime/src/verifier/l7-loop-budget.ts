import type { AgentDispositionFile } from "../lib/disposition.js";
import { formatFollowupMessage, type RuntimeStateFile } from "../lib/runtime-state.js";
import { resolveAgentId } from "../lib/runtime-state.js";
import { budgetLoopCount, cursorStopLoopFromInput } from "../lib/loop-count.js";
import { readRepoBlockedStopTotal } from "../lib/goal-loop.js";
import type { VerifierContext } from "./types.js";

export async function resolveLoopBudgetMessage(
  ctx: VerifierContext,
  runtimeState: RuntimeStateFile,
): Promise<string> {
  const repoTotal = await readRepoBlockedStopTotal(ctx.root);
  return (
    ctx.followupMessage ??
    formatFollowupMessage(
      runtimeState,
      cursorStopLoopFromInput(ctx.input),
      repoTotal,
      resolveAgentId(ctx.input),
    )
  );
}

export function isLoopBudgetDisposition(ctx: VerifierContext): boolean {
  return budgetLoopCount(ctx) >= ctx.loopLimit - 2;
}

export function buildDispositionWrite(
  ctx: VerifierContext,
  summary: string,
): { data: AgentDispositionFile; mdBody: string } {
  const agentId = resolveAgentId(ctx.input);
  const md = [
    "# Disposition",
    "",
    `- agent: ${agentId}`,
    `- at: ${new Date().toISOString()}`,
    `- mode: runtime`,
    `- failed:`,
    ...ctx.failures.map((f) => `  - \`${f}\``),
    "",
  ].join("\n");
  return {
    data: {
      status: "DISPOSITION",
      recoverable: true,
      failed: ctx.failures,
      loop_count: budgetLoopCount(ctx),
      conversation_id: ctx.input.conversation_id,
      agent_id: agentId,
      at: new Date().toISOString(),
      summary: summary.slice(0, 500),
      mode: "runtime",
    },
    mdBody: md,
  };
}

export function dispositionForLoop(
  ctx: VerifierContext,
  summary: string,
  loopCount: number,
  repeatedSignatureCount = 0,
): { data: AgentDispositionFile; mdBody: string } | undefined {
  const finalCtx = { ...ctx, loopCount };
  if (!isLoopBudgetDisposition(finalCtx) && repeatedSignatureCount < 3) {
    return undefined;
  }
  return buildDispositionWrite(finalCtx, summary);
}

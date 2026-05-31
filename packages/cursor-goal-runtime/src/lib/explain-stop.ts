import { createHash } from "node:crypto";
import { projectRoot } from "./paths.js";
import { resolveAgentId, readAgentHandoffRead } from "./runtime-state.js";
import { buildOperatorNextAction } from "./operator.js";
import { runStopPipeline } from "../verifier/pipeline.js";
import { parseGoalMd } from "./parse-goal-md.js";
import { gitTreeId } from "./git-state.js";
import { runChecks } from "./run-checks.js";
import { readLoopLimit } from "./loop-limit.js";
import { readRepoBlockedStopTotal } from "./goal-loop.js";
import { readAgentLoopCount } from "./agent-runtime-state.js";
import { readStopTraceTail, type StopTraceEntry } from "./stop-trace.js";
import { levelWorkUnitsBlocked } from "../verifier/l-work-units.js";
import { levelTrajectoryBlocked } from "../verifier/l-trajectory.js";
import { levelFreshProofBlocked } from "../verifier/l6-fresh-proof.js";
import type { StopInput, VerifierContext } from "../verifier/types.js";

export type ExplainReport = {
  level_failed: string | null;
  failures: string[];
  check_results: Array<{ cmd: string; ok: boolean; output?: string }>;
  phase?: string;
  units_blocked: boolean;
  phase_blocked: boolean;
  next_action: string;
  pipeline_result: "release" | "continue" | "disposition" | "idle";
  agent_handoff_blocked: boolean;
  last_stop_trace: StopTraceEntry | null;
};

function levelFromFailures(failures: string[]): string | null {
  if (!failures.length) return null;
  const f = failures[0];
  if (f.startsWith("stale-proof")) return "L6";
  if (f.startsWith("forbidden-proxy")) return "L5";
  if (f.startsWith("out-of-scope:")) return "L4";
  return "L3";
}

export async function buildExplainReport(
  input: StopInput = { status: "completed" },
): Promise<ExplainReport> {
  const root = projectRoot();
  const agentId = resolveAgentId(input);
  const parsed = await parseGoalMd(root);
  const checkResults = await runChecks(root, parsed.checks);
  const loopCount =
    agentId != null
      ? await readAgentLoopCount(root, agentId)
      : await readRepoBlockedStopTotal(root);
  const ctx: VerifierContext = {
    root,
    input,
    parsed,
    loopLimit: await readLoopLimit(root),
    loopCount,
    failures: [] as string[],
    checkResults,
    currentTree: gitTreeId(root),
    phaseBlocked: false,
    unitsBlocked: false,
  };
  for (const c of checkResults) {
    if (!c.ok) ctx.failures.push(c.cmd);
  }
  await levelFreshProofBlocked(ctx);
  ctx.unitsBlocked = await levelWorkUnitsBlocked(ctx);
  const traj = await levelTrajectoryBlocked(ctx);
  ctx.phaseBlocked = traj.blocked;
  ctx.phase = traj.phase;

  const pipeline = await runStopPipeline(input, { dryRun: true });
  const mergedFailures = [...new Set([...ctx.failures, ...(pipeline.kind === "disposition" ? pipeline.failed : [])])];
  const { submitBlocked } = await readAgentHandoffRead(root, agentId);
  const traceTail = await readStopTraceTail(root, 1);
  const lastStopTrace = traceTail.length ? (traceTail[traceTail.length - 1] ?? null) : null;

  return {
    level_failed: levelFromFailures(mergedFailures),
    failures: mergedFailures,
    check_results: checkResults.map((c) => ({
      cmd: c.cmd,
      ok: c.ok,
      output: c.output,
    })),
    phase: ctx.phase,
    units_blocked: ctx.unitsBlocked,
    phase_blocked: ctx.phaseBlocked,
    next_action: await buildOperatorNextAction(root, { conversation_id: agentId }),
    pipeline_result: pipeline.kind,
    agent_handoff_blocked: submitBlocked,
    last_stop_trace: lastStopTrace,
  };
}

export function formatExplainReport(report: ExplainReport): string {
  const lines = [
    `Pipeline: ${report.pipeline_result}`,
    report.level_failed ? `First failing level: ${report.level_failed}` : "No L-level failures from checks",
    "",
    "Failures:",
    ...(report.failures.length ? report.failures.map((f) => `- ${f}`) : ["- none"]),
    "",
    "Checks:",
    ...report.check_results.map((c) =>
      `- ${c.ok ? "PASS" : "FAIL"} ${c.cmd}${c.output ? `\n  ${c.output.split("\n").slice(0, 3).join("\n  ")}` : ""}`,
    ),
    "",
    `Units blocked: ${report.units_blocked}`,
    `Phase blocked: ${report.phase_blocked}`,
    `Agent submit blocked: ${report.agent_handoff_blocked}`,
    "",
    ...(report.last_stop_trace
      ? [
          "Last stop:",
          `- at: ${report.last_stop_trace.at}`,
          `- pipeline: ${report.last_stop_trace.pipeline_result}`,
          `- level: ${report.last_stop_trace.level_failed ?? "none"}`,
          ...(report.last_stop_trace.failures.length
            ? ["- failures:", ...report.last_stop_trace.failures.map((f) => `  - ${f}`)]
            : ["- failures: none"]),
          "",
        ]
      : ["Last stop: (no stop-trace.jsonl entries)", ""]),
    "Next action:",
    report.next_action,
  ];
  return lines.join("\n");
}

export function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt.trim()).digest("hex").slice(0, 16);
}

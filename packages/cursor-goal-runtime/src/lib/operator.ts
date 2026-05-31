import { existsSync } from "node:fs";
import path from "node:path";
import { formatNextAction } from "./next-action.js";
import {
  readAgentHandoffRead,
  readRepoRuntimeSummary,
  runtimeStatePath,
  computeRuntimeState,
} from "./runtime-state.js";
import { readRepoBlockedStopTotal } from "./goal-loop.js";
import { countSubmitBlockedAgents } from "./agent-runtime-state.js";
import {
  countAgentsInDisposition,
  listAgentsInDisposition,
  sessionEndMarkerPath,
} from "./disposition.js";
import type { RuntimeStateFile } from "./runtime-state.js";
import { goalDir, goalMd, passportsDir, projectRoot } from "./paths.js";
import { readAgentLoopCount } from "./agent-runtime-state.js";
import { resolveAgentId, type AgentIdSource } from "./runtime-state.js";
import { readLoopLimit } from "./loop-limit.js";
import { parseGoalMd } from "./parse-goal-md.js";
import { runChecks } from "./run-checks.js";
import { pendingUnits, readWorkUnits } from "./work-units.js";
import { readTrajectory, type Phase } from "../trajectory/fsm.js";
import type { VerifierContext } from "../verifier/types.js";
import { levelWorkUnitsBlocked } from "../verifier/l-work-units.js";
import { isRuntimeStateStale } from "./dispatch-cli.js";
import { resolveDispatchHead } from "./dispatch-head.js";

export type OperatorSnapshot = RuntimeStateFile & {
  dispatch_head?: {
    unit_id: string;
    task_prompt: string;
    queue_index: number;
  };
  runtime_state_stale?: boolean;
};

export type OperatorSnapshotOptions = {
  agentId?: string;
};

async function buildFreshContext(
  root: string,
  agentId?: string,
): Promise<{
  ctx: VerifierContext;
  blocked: boolean;
  phase: Phase;
}> {
  const parsed = await parseGoalMd(root);
  const checkResults = await runChecks(root, parsed.checks);
  const loopCount =
    agentId != null
      ? await readAgentLoopCount(root, agentId)
      : await readRepoBlockedStopTotal(root);
  const ctx: VerifierContext = {
    root,
    input: { status: "completed" },
    parsed,
    loopLimit: await readLoopLimit(root),
    loopCount,
    failures: [],
    checkResults,
    currentTree: "operator",
    phaseBlocked: false,
    unitsBlocked: false,
  };

  for (const c of checkResults) {
    if (!c.ok) ctx.failures.push(c.cmd);
  }

  ctx.unitsBlocked = await levelWorkUnitsBlocked(ctx);
  const traj = await readTrajectory(root);
  const phaseGate = await import("../verifier/l-trajectory.js").then((m) =>
    m.levelTrajectoryBlocked(ctx),
  );
  ctx.phaseBlocked = phaseGate.blocked;
  ctx.phase = traj.phase;

  const blocked = ctx.failures.length > 0 || ctx.unitsBlocked || ctx.phaseBlocked;
  return { ctx, blocked, phase: (ctx.phase ?? traj.phase) as Phase };
}

export async function buildOperatorSnapshot(
  root?: string,
  options?: OperatorSnapshotOptions | AgentIdSource,
): Promise<OperatorSnapshot | { error: string }> {
  const r = root ?? projectRoot();
  if (!existsSync(goalMd(r))) {
    return { error: "GOAL.md missing. Run: cursor-goal init" };
  }

  const agentId = resolveOperatorAgentId(options);

  const stale = await isRuntimeStateStale(r);

  const { handoff, submitBlocked } = await readAgentHandoffRead(r, agentId);
  const { ctx, blocked: liveBlocked, phase } = await buildFreshContext(r, agentId);
  const blocked = liveBlocked || submitBlocked;
  const state = await computeRuntimeState({
    ctx,
    phase,
    phaseBlocked: ctx.phaseBlocked,
    unitsBlocked: ctx.unitsBlocked,
    blocked,
  });

  let merged: RuntimeStateFile = state;
  if (submitBlocked) {
    const blockers = handoff
      ? [...state.blockers, ...handoff.blockers]
      : [...state.blockers, "submit:blocked"];
    merged = {
      ...state,
      blocked: true,
      loop_count: Math.max(state.loop_count, handoff?.loop_count ?? 0),
      blockers: [...new Set(blockers)],
      next_action: state.next_action ?? handoff?.next_action ?? null,
      last_check_fail: state.last_check_fail ?? handoff?.last_check_fail ?? null,
    };
  }

  const snap: OperatorSnapshot = { ...merged, runtime_state_stale: stale };
  const head = await resolveDispatchHead(r);
  if (head) {
    snap.dispatch_head = {
      unit_id: head.unit.id,
      task_prompt: head.taskPrompt,
      queue_index: head.queueIndex,
    };
  }
  return snap;
}

function resolveOperatorAgentId(
  options?: OperatorSnapshotOptions | AgentIdSource,
): string {
  if (options && "agentId" in options && options.agentId) return options.agentId;
  const fromOpt =
    options && "conversation_id" in options && options.conversation_id
      ? options.conversation_id
      : undefined;
  return resolveAgentId(fromOpt ?? { conversation_id: process.env.CURSOR_CONVERSATION_ID });
}

export async function buildOperatorNextAction(
  root?: string,
  options?: OperatorSnapshotOptions | AgentIdSource,
): Promise<string> {
  const snap = await buildOperatorSnapshot(root, options);
  if ("error" in snap) return snap.error;

  if (!snap.blocked) {
    return "No blockers — run cursor-goal verify or stop hook for RELEASE.";
  }

  if (snap.next_action) {
    return formatNextAction({
      kind: snap.next_action.kind,
      headline: snap.next_action.headline,
      detail: snap.next_action.detail,
      taskPrompt: snap.next_action.task_prompt,
    });
  }

  return snap.blockers.join("; ") || "Blocked — see runtime-state.json";
}

export async function formatOperatorStatus(root?: string): Promise<string> {
  const r = root ?? projectRoot();
  const summary = await readRepoRuntimeSummary(r);
  const stale = await isRuntimeStateStale(r);
  const traj = await readTrajectory(r);
  const wu = await readWorkUnits(r);
  const open = wu ? pendingUnits(wu.units) : [];
  const loop = await readRepoBlockedStopTotal(r);
  const limit = summary?.loop_limit ?? (await readLoopLimit(r));
  const blockedAgents = countSubmitBlockedAgents(r);
  const dispositionAgents = countAgentsInDisposition(r);
  const lines = [
    `phase: ${summary?.phase ?? traj.phase}`,
    `repo_blocked_stops: ${loop}/${limit}`,
    `blocked_agents: ${blockedAgents}`,
    `disposition_agents: ${dispositionAgents}`,
    `RELEASE: ${existsSync(path.join(passportsDir(r), "RELEASE.json"))}`,
    `DISPOSITION: ${dispositionAgents > 0 ? listAgentsInDisposition(r).join(",") : "false"}`,
    `SESSION_END: ${existsSync(sessionEndMarkerPath(r))}`,
    `PAUSED: ${existsSync(path.join(goalDir(r), "PAUSED"))}`,
    `work_units: ${wu ? wu.units.length - open.length : 0}/${wu?.units?.length ?? 0} done`,
  ];
  if (stale) lines.push("runtime_state_stale: true");
  if (open.length) lines.push(`open_units: ${open.map((u) => `${u.id}(${u.status})`).join(", ")}`);
  if (existsSync(runtimeStatePath(r))) lines.push("runtime_state: .cursor/goal/runtime-state.json");
  return lines.join("\n");
}

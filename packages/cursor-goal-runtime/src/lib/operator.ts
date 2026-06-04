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
  hasAgentDisposition,
  countAgentsInDisposition,
  listAgentsInDisposition,
  sessionEndMarkerPath,
} from "./disposition.js";
import type { RuntimeStateFile } from "./runtime-state.js";
import { goalDir, goalMd, passportsDir, projectRoot } from "./paths.js";
import { readAgentLoopCount } from "./agent-runtime-state.js";
import { resolveAgentId, type AgentIdSource } from "./runtime-state.js";
import { readLoopLimit } from "./loop-limit.js";
import { pendingUnits, readWorkUnits } from "./work-units.js";
import { readTrajectory } from "../trajectory/fsm.js";
import { isRuntimeStateStale } from "./dispatch-cli.js";
import { resolveDispatchHead } from "./dispatch-head.js";
import { readPromptContext } from "./prompt-context.js";
import { readStopTraceTail, sumTokenUsage } from "./stop-trace.js";
import { acceptancePreflightForOpenUnits } from "./unit-acceptance-snapshot.js";
import { buildStopAlignedContext } from "./stop-aligned-context.js";

export type BlockedSources = {
  checks: boolean;
  units: boolean;
  phase: boolean;
  disposition: boolean;
  submit: boolean;
};

export type OperatorSnapshot = RuntimeStateFile & {
  dispatch_head?: {
    unit_id: string;
    task_prompt: string;
    queue_index: number;
  };
  runtime_state_stale?: boolean;
  blocked_sources?: BlockedSources;
  advisory_warnings?: string[];
  acceptance_preflight?: Record<string, boolean>;
};

export type OperatorSnapshotOptions = {
  agentId?: string;
};

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
  const dispositionBlocked = await hasAgentDisposition(r, agentId).catch(() => false);
  let aligned: Awaited<ReturnType<typeof buildStopAlignedContext>>;
  try {
    aligned = await buildStopAlignedContext(r, { conversation_id: agentId });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const { ctx, blocked: liveBlocked, phase } = aligned;
  const promptContext = await readPromptContext(r, agentId).catch(() => null);
  const blocked = liveBlocked || dispositionBlocked;
  const state = await computeRuntimeState({
    ctx,
    phase,
    phaseBlocked: ctx.phaseBlocked,
    unitsBlocked: ctx.unitsBlocked,
    blocked,
    promptContext,
  });

  let merged: RuntimeStateFile = state;
  if (submitBlocked && blocked) {
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

  const blocked_sources: BlockedSources = {
    checks: ctx.checkResults.some((c) => !c.ok),
    units: ctx.unitsBlocked === true,
    phase: ctx.phaseBlocked === true,
    disposition: countAgentsInDisposition(r) > 0,
    submit: submitBlocked,
  };

  const snap: OperatorSnapshot = {
    ...merged,
    runtime_state_stale: stale,
    blocked_sources,
    advisory_warnings: [],
    acceptance_preflight: await acceptancePreflightForOpenUnits(r).catch(() => ({})),
  };
  if ((promptContext?.out_of_scope_paths?.length ?? 0) > 0) {
    snap.advisory_warnings?.push(
      `Prompt context references out-of-scope paths: ${promptContext?.out_of_scope_paths.join(", ")}`,
    );
  }
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
    }, { includeTaskPrompt: true });
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
  const snap = await buildOperatorSnapshot(r);
  if (!("error" in snap) && snap.blocked && snap.blocked_sources) {
    const parts: string[] = [];
    if (snap.blocked_sources.checks) parts.push("checks");
    if (snap.blocked_sources.units) parts.push("units");
    if (snap.blocked_sources.phase) parts.push("phase");
    if (snap.blocked_sources.disposition) parts.push("disposition");
    if (snap.blocked_sources.submit) parts.push("submit");
    if (parts.length) lines.push(`blocked_because: ${parts.join(", ")}`);
  }
  const traces = await readStopTraceTail(r, 100);
  const tokens = sumTokenUsage(traces);
  if (tokens.input || tokens.output) {
    const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);
    lines.push(`token_usage: in=${fmt(tokens.input)} out=${fmt(tokens.output)} cache_r=${fmt(tokens.cache_read)} cache_w=${fmt(tokens.cache_write)}`);
  }
  return lines.join("\n");
}

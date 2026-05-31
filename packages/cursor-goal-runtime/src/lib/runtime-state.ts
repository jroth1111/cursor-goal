import { existsSync } from "node:fs";
import { lstat, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Phase } from "../trajectory/fsm.js";
import { resolveQueueHead } from "./dispatch-queue.js";
import {
  buildNextAction,
  formatNextAction,
  secondaryBlockers,
  type NextAction,
  type NextActionKind,
} from "./next-action.js";
import { buildUnitTaskPrompt } from "./unit-task-prompt.js";
import { findUnitById, readWorkUnits } from "./work-units.js";
import { goalDir, passportsDir, projectRoot, readJson } from "./paths.js";
import { readLoopLimit } from "./loop-limit.js";
import type { CheckResult } from "./run-checks.js";
import type { VerifierContext } from "../verifier/types.js";
import {
  clearAgentBlockedState,
  clearAllAgentsBlockedState,
  countSubmitBlockedAgents,
  readAgentLoopCount,
  readAgentRuntimeState,
  resolveAgentId,
  writeAgentRuntimeState,
  type AgentIdSource,
} from "./agent-runtime-state.js";
import { withGoalDirLock } from "./goal-dir-lock.js";
import {
  clearAgentDispositionUnlocked,
  isAgentSubmitBlocked,
  readAgentDisposition,
  writeAgentDispositionUnlocked,
  type AgentDispositionFile,
} from "./disposition.js";
import {
  incrementRepoBlockedStopTotalUnlocked,
  readRepoBlockedStopTotal,
  resetRepoBlockedStopTotalUnlocked,
} from "./goal-loop.js";

export type RuntimeStateNextAction = {
  kind: NextActionKind;
  headline: string;
  detail: string;
  task_prompt?: string;
  queue_index?: number;
  unit_id?: string;
};

export type RuntimeStateCheckFail = {
  cmd: string;
  output: string;
  at: string;
};

export type RuntimeStateMode = "runtime" | "minimal";

/** Per-agent or legacy full runtime state. */
export type RuntimeStateFile = {
  mode: RuntimeStateMode;
  loop_count: number;
  loop_limit: number;
  phase: Phase | string;
  blocked: boolean;
  blockers: string[];
  next_action: RuntimeStateNextAction | null;
  last_check_fail: RuntimeStateCheckFail | null;
  updated_at: string;
};

/** Repo-wide summary (`.cursor/goal/runtime-state.json`). */
export type RepoRuntimeSummary = {
  mode: RuntimeStateMode;
  total_blocked_stops: number;
  loop_limit: number;
  phase: Phase | string;
  blocked_agent_count: number;
  updated_at: string;
};

export type ReleasePassportFile = {
  status: "RELEASE";
  at: string;
  mode: RuntimeStateMode;
  loop_count: number;
  [key: string]: unknown;
};

export type ReadRuntimeStateOptions = {
  agentId?: string;
};

export function runtimeStatePath(root?: string): string {
  return path.join(goalDir(root), "runtime-state.json");
}

function toStoredAction(action: NextAction | null, extras?: Partial<RuntimeStateNextAction>): RuntimeStateNextAction | null {
  if (!action) return null;
  return {
    kind: action.kind,
    headline: action.headline,
    detail: action.detail,
    ...(action.taskPrompt ? { task_prompt: action.taskPrompt } : {}),
    ...extras,
  };
}

function firstCheckFail(results: CheckResult[]): RuntimeStateCheckFail | null {
  const failed = results.find((r) => !r.ok);
  if (!failed) return null;
  return {
    cmd: failed.cmd,
    output: (failed.output ?? "(no output captured)").slice(0, 4000),
    at: new Date().toISOString(),
  };
}

/** Repo-wide view for callers without an agent id (not a specific conversation handoff). */
function legacyFullStateFromSummary(summary: RepoRuntimeSummary): RuntimeStateFile {
  return {
    mode: summary.mode,
    loop_count: summary.total_blocked_stops,
    loop_limit: summary.loop_limit,
    phase: summary.phase,
    blocked: summary.blocked_agent_count > 0,
    blockers:
      summary.blocked_agent_count > 0
        ? [
            `${summary.blocked_agent_count} agent(s) submit-blocked — see agents/<id>/runtime-state.json or DISPOSITION.md`,
          ]
        : [],
    next_action: null,
    last_check_fail: null,
    updated_at: summary.updated_at,
  };
}

function summaryFromLegacy(state: RuntimeStateFile): RepoRuntimeSummary {
  return {
    mode: state.mode,
    total_blocked_stops: state.loop_count,
    loop_limit: state.loop_limit,
    phase: state.phase,
    blocked_agent_count: state.blocked ? 1 : 0,
    updated_at: state.updated_at,
  };
}

function normalizeRepoRuntimeSummary(
  root: string,
  base: RepoRuntimeSummary | null,
): Promise<RepoRuntimeSummary> {
  return Promise.all([readRepoBlockedStopTotal(root), readLoopLimit(root)]).then(
    ([liveTotal, limit]) => ({
      mode: base?.mode ?? "runtime",
      total_blocked_stops: liveTotal,
      loop_limit: base?.loop_limit ?? limit,
      phase: base?.phase ?? "DISCOVERY",
      blocked_agent_count: countSubmitBlockedAgents(root),
      updated_at: base?.updated_at ?? new Date().toISOString(),
    }),
  );
}

/** Repo summary with live goal-loop total and submit-blocked agent count from disk. */
export async function readRepoRuntimeSummary(root?: string): Promise<RepoRuntimeSummary | null> {
  const r = root ?? projectRoot();
  const p = runtimeStatePath(r);
  let base: RepoRuntimeSummary | null = null;
  if (existsSync(p)) {
    try {
      const raw = await readJson<RepoRuntimeSummary & RuntimeStateFile>(p);
      if (raw) {
        base =
          typeof raw.total_blocked_stops === "number"
            ? (raw as RepoRuntimeSummary)
            : summaryFromLegacy(raw as RuntimeStateFile);
      }
    } catch {
      base = null;
    }
  }
  if (!base) {
    const liveBlocked = countSubmitBlockedAgents(r);
    const liveTotal = await readRepoBlockedStopTotal(r);
    if (liveBlocked === 0 && liveTotal === 0) return null;
  }
  return normalizeRepoRuntimeSummary(r, base);
}

async function writeRepoRuntimeSummary(root: string, summary: RepoRuntimeSummary): Promise<void> {
  const file = runtimeStatePath(root);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

export type AgentHandoffRead = {
  handoff: RuntimeStateFile | null;
  submitBlocked: boolean;
};

async function buildAgentHandoffState(
  root: string,
  agentId: string,
  submitBlocked: boolean,
): Promise<RuntimeStateFile | null> {
  const persisted = await readAgentRuntimeState(root, agentId);
  if (!persisted && !submitBlocked) return null;

  const limit = await readLoopLimit(root);
  const disposition = submitBlocked || !persisted ? await readAgentDisposition(root, agentId) : null;
  const base: RuntimeStateFile =
    persisted ??
    ({
      mode: "runtime",
      loop_count: disposition?.loop_count ?? 0,
      loop_limit: limit,
      phase: "DISCOVERY",
      blocked: false,
      blockers: [],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    } satisfies RuntimeStateFile);

  if (!submitBlocked) return base;

  const blockers = [...base.blockers];
  if (disposition) {
    if (!blockers.includes("disposition:required")) blockers.push("disposition:required");
    for (const f of disposition.failed) {
      if (!blockers.includes(f)) blockers.push(f);
    }
  } else if (!blockers.length) {
    blockers.push("handoff:blocked");
  }

  return {
    ...base,
    blocked: true,
    blockers,
    loop_count: Math.max(base.loop_count, disposition?.loop_count ?? 0),
    loop_limit: limit,
  };
}

/** Per-agent handoff + submit-block flag (single `isAgentSubmitBlocked` read). */
export async function readAgentHandoffRead(
  root: string,
  agentId: string,
): Promise<AgentHandoffRead> {
  const submitBlocked = await isAgentSubmitBlocked(root, agentId);
  const handoff = await buildAgentHandoffState(root, agentId, submitBlocked);
  return { handoff, submitBlocked };
}

/** Per-agent handoff merged with disposition / submit-block (read-only view). */
export async function readAgentHandoffState(
  root: string,
  agentId: string,
): Promise<RuntimeStateFile | null> {
  const { handoff } = await readAgentHandoffRead(root, agentId);
  return handoff;
}

/**
 * Without `agentId`: repo aggregate view (`loop_count` = repo total, no per-agent `next_action`).
 * With `agentId`: handoff view including disposition submit-block.
 */
export async function readRuntimeState(
  root?: string,
  options?: ReadRuntimeStateOptions,
): Promise<RuntimeStateFile | null> {
  const r = root ?? projectRoot();
  if (options?.agentId) {
    return readAgentHandoffState(r, options.agentId);
  }
  const summary = await readRepoRuntimeSummary(r);
  if (!summary) return null;
  return legacyFullStateFromSummary(summary);
}

async function writeAgentAndRepoSummaryUnlocked(
  root: string,
  state: RuntimeStateFile,
  agentId: string,
): Promise<void> {
  await writeAgentRuntimeState(root, agentId, state);
  const total = await readRepoBlockedStopTotal(root);
  const summary: RepoRuntimeSummary = {
    mode: state.mode,
    total_blocked_stops: total,
    loop_limit: state.loop_limit,
    phase: state.phase,
    blocked_agent_count: countSubmitBlockedAgents(root),
    updated_at: new Date().toISOString(),
  };
  await writeRepoRuntimeSummary(root, summary);
}

export async function writeRuntimeStateFile(
  root: string,
  state: RuntimeStateFile,
  agentId?: string,
): Promise<void> {
  const id = agentId ?? "default";
  await withGoalDirLock(root, async () => {
    await writeAgentAndRepoSummaryUnlocked(root, state, id);
  });
}

export type RecordBlockedStopOptions = {
  disposition?: {
    data: AgentDispositionFile;
    mdBody?: string;
  };
};

/** Atomically increment repo + agent counters, persist handoff, optional disposition (one lock). */
export async function recordBlockedStop(
  root: string,
  agentId: string,
  fromCount: number,
  state: RuntimeStateFile,
  options?: RecordBlockedStopOptions,
): Promise<{ agentLoop: number; repoTotal: number }> {
  return withGoalDirLock(root, async () => {
    const currentAgentLoop = await readAgentLoopCount(root, agentId);
    const agentLoop = Math.max(fromCount, currentAgentLoop) + 1;
    const stateWithLoop: RuntimeStateFile = {
      ...state,
      loop_count: agentLoop,
      blocked: true,
      updated_at: new Date().toISOString(),
    };
    const repoTotal = await incrementRepoBlockedStopTotalUnlocked(root);
    await writeAgentAndRepoSummaryUnlocked(root, stateWithLoop, agentId);
    if (options?.disposition) {
      await writeAgentDispositionUnlocked(
        root,
        agentId,
        {
          ...options.disposition.data,
          loop_count: Math.max(options.disposition.data.loop_count, agentLoop),
        },
        options.disposition.mdBody,
      );
    }
    return { agentLoop, repoTotal };
  });
}

async function prepareReleasePassport(
  root: string,
  data: ReleasePassportFile,
): Promise<{ commit: () => Promise<void>; cleanup: () => Promise<void> }> {
  const dir = passportsDir(root);
  await mkdir(dir, { recursive: true });
  const releasePath = path.join(dir, "RELEASE.json");
  try {
    const existing = await lstat(releasePath);
    if (!existing.isFile()) {
      throw new Error(`${releasePath} exists but is not a regular file`);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const tmp = path.join(dir, `.RELEASE.json.tmp.${process.pid}.${Date.now()}`);
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return {
    commit: async () => {
      await rename(tmp, releasePath);
    },
    cleanup: async () => {
      await unlink(tmp).catch(() => undefined);
    },
  };
}

async function clearSessionEndMarkerUnlocked(root: string): Promise<void> {
  await unlink(path.join(passportsDir(root), "SESSION_END.json")).catch(() => undefined);
  await unlink(path.join(passportsDir(root), "SESSION_END.md")).catch(() => undefined);
}

/** Prepare RELEASE before reset, then commit state + passport under one goal-dir lock. */
export async function releaseRuntimeState(
  root: string,
  releasingAgentId: string,
  releasedState: RuntimeStateFile,
  releasePassport: ReleasePassportFile,
): Promise<void> {
  const prepared = await prepareReleasePassport(root, releasePassport);
  let committed = false;
  try {
    await withGoalDirLock(root, async () => {
      await resetRepoBlockedStopTotalUnlocked(root);
      await clearAllAgentsBlockedState(root);
      await clearAgentDispositionUnlocked(root, releasingAgentId);
      await writeAgentAndRepoSummaryUnlocked(root, releasedState, releasingAgentId);
      await clearSessionEndMarkerUnlocked(root);
      await prepared.commit();
      committed = true;
    });
  } finally {
    if (!committed) await prepared.cleanup();
  }
}

export type ComputeRuntimeStateInput = {
  ctx: VerifierContext;
  phase?: Phase;
  phaseBlocked?: boolean;
  unitsBlocked?: boolean;
  blocked: boolean;
  mode?: RuntimeStateMode;
};

export async function computeRuntimeState(input: ComputeRuntimeStateInput): Promise<RuntimeStateFile> {
  const { ctx, blocked } = input;
  const phase = input.phase ?? ctx.phase ?? "DISCOVERY";

  let nextAction = await buildNextAction({
    ctx,
    phase,
    phaseBlocked: input.phaseBlocked ?? ctx.phaseBlocked,
    unitsBlocked: input.unitsBlocked ?? ctx.unitsBlocked,
  });

  const head = await resolveQueueHead(ctx.root);
  if (nextAction?.kind === "dispatch_unit" && head) {
    const unit = findUnitById((await readWorkUnits(ctx.root))?.units ?? [], head.item.unit_id);
    if (unit && unit.status !== "done") {
      nextAction = {
        kind: "dispatch_unit",
        headline: `Dispatch work unit "${unit.id}" (queue ${head.index + 1})`,
        detail: "Spawn one Task/subagent with the task_prompt below, or use supervisor for 2+ units.",
        taskPrompt: buildUnitTaskPrompt(unit),
      };
    }
  }

  const blockers: string[] = [...ctx.failures];
  if (input.phaseBlocked ?? ctx.phaseBlocked) blockers.push(`phase:${phase}`);
  if (input.unitsBlocked ?? ctx.unitsBlocked) blockers.push("units:open");

  return {
    mode: input.mode ?? "runtime",
    loop_count: ctx.loopCount,
    loop_limit: ctx.loopLimit,
    phase,
    blocked,
    blockers,
    next_action: blocked
      ? toStoredAction(nextAction, head
          ? { queue_index: head.index, unit_id: head.item.unit_id }
          : undefined)
      : null,
    last_check_fail: blocked ? firstCheckFail(ctx.checkResults) : null,
    updated_at: new Date().toISOString(),
  };
}

export function formatGoalLoopLine(
  goalCount: number,
  loopLimit: number,
  cursorIndex?: number | null,
  mode: RuntimeStateMode = "runtime",
  repoTotal?: number | null,
): string {
  let base = `GOAL loop ${goalCount}/${loopLimit} [${mode}]`;
  if (repoTotal != null && repoTotal >= 0 && repoTotal !== goalCount) {
    base += ` (repo ${repoTotal}/${loopLimit})`;
  }
  if (cursorIndex != null && cursorIndex >= 0 && cursorIndex !== goalCount) {
    return `${base} (agent stop ${cursorIndex}/${loopLimit})`;
  }
  return base;
}

export function formatFollowupMessage(
  state: RuntimeStateFile,
  cursorIndex?: number | null,
  repoTotal?: number | null,
  agentId?: string,
): string {
  if (!state.blocked) {
    return "No blockers — ready for RELEASE.";
  }

  const lines: string[] = [
    formatGoalLoopLine(state.loop_count, state.loop_limit, cursorIndex, state.mode, repoTotal),
    "",
  ];

  if (state.next_action) {
    const action: NextAction = {
      kind: state.next_action.kind,
      headline: state.next_action.headline,
      detail: state.next_action.detail,
      taskPrompt: state.next_action.task_prompt,
    };
    lines.push(formatNextAction(action));
  } else if (state.blockers.length) {
    lines.push("## Blockers", "", state.blockers.slice(0, 5).join("; "));
  }

  if (state.last_check_fail) {
    lines.push("", "## Last check failure", "", `\`${state.last_check_fail.cmd}\``, "```", state.last_check_fail.output.trim() || "(empty)", "```");
  }

  const also = secondaryBlockers(state).slice(0, 3);
  if (also.length) {
    lines.push("", "## Also blocked", "", also.join("; "));
  }

  const id = agentId ?? "default";
  const agentPath = state.blocked
    ? `.cursor/goal/agents/${id}/runtime-state.json`
    : ".cursor/goal/runtime-state.json";
  const nextHint =
    agentId && agentId !== "default"
      ? `cursor-goal next --conversation ${agentId}`
      : "cursor-goal next";
  lines.push("", `Full state: ${agentPath}`, `Operator: ${nextHint}`);
  return lines.join("\n").trim();
}

export function formatDispositionMessage(
  state: RuntimeStateFile,
  cursorIndex?: number | null,
  repoTotal?: number | null,
  agentId?: string,
): string {
  const id = agentId ?? "default";
  const lines = [
    "## Disposition — loop budget exhausted",
    "",
    formatGoalLoopLine(state.loop_count, state.loop_limit, cursorIndex, state.mode, repoTotal),
    "",
    `Human review required. See .cursor/goal/agents/${id}/DISPOSITION.md`,
    "",
    formatFollowupMessage(state, cursorIndex, repoTotal, id),
  ];
  return lines.join("\n").trim();
}

/** Clear blocked flag for one agent on setup/continue halts. */
export async function writeUnblockedContinueState(
  root?: string,
  partial?: { loopCount?: number; phase?: Phase | string; agentId?: string },
): Promise<void> {
  const r = root ?? projectRoot();
  const agentId = partial?.agentId ?? "default";
  await withGoalDirLock(r, async () => {
    await clearAgentBlockedState(r, agentId, partial);
    const summary = await readRepoRuntimeSummary(r);
    const limit = await readLoopLimit(r);
    const total = await readRepoBlockedStopTotal(r);
    await writeRepoRuntimeSummary(r, {
      mode: summary?.mode ?? "runtime",
      total_blocked_stops: total,
      loop_limit: limit,
      phase: partial?.phase ?? summary?.phase ?? "DISCOVERY",
      blocked_agent_count: countSubmitBlockedAgents(r),
      updated_at: new Date().toISOString(),
    });
  });
}

export async function readPersistedLoopCount(
  root?: string,
  agentId?: string,
): Promise<number> {
  const r = root ?? projectRoot();
  if (agentId) {
    return readAgentLoopCount(r, agentId);
  }
  return readRepoBlockedStopTotal(r);
}

export async function persistLoopCount(
  root: string,
  n: number,
  options?: { blocked?: boolean; agentId?: string },
): Promise<void> {
  const agentId = options?.agentId ?? "default";
  const limit = await readLoopLimit(root);
  const existing =
    (await readAgentRuntimeState(root, agentId)) ??
    ({
      mode: "runtime" as const,
      loop_count: 0,
      loop_limit: limit,
      phase: "DISCOVERY",
      blocked: false,
      blockers: [],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    } satisfies RuntimeStateFile);
  const blocked = options?.blocked ?? existing.blocked;
  const nextState: RuntimeStateFile = {
    ...existing,
    loop_count: n,
    loop_limit: limit,
    blocked,
    ...(blocked
      ? {}
      : {
          blockers: [],
          next_action: null,
          last_check_fail: null,
        }),
    updated_at: new Date().toISOString(),
  };
  await withGoalDirLock(root, async () => {
    await writeAgentAndRepoSummaryUnlocked(root, nextState, agentId);
  });
}

/** Reset repo loop + clear all agents' blocked handoff; optional releasing agent state in same lock. */
export async function resetLoopCount(
  root?: string,
  releasingAgentId?: string,
  releasedState?: RuntimeStateFile,
): Promise<void> {
  const r = root ?? projectRoot();
  await withGoalDirLock(r, async () => {
    await resetRepoBlockedStopTotalUnlocked(r);
    await clearAllAgentsBlockedState(r);
    if (releasingAgentId) {
      await clearAgentDispositionUnlocked(r, releasingAgentId);
    }
    if (releasedState && releasingAgentId) {
      await writeAgentAndRepoSummaryUnlocked(r, releasedState, releasingAgentId);
    } else {
      const limit = await readLoopLimit(r);
      const summary = await readRepoRuntimeSummary(r);
      await writeRepoRuntimeSummary(r, {
        mode: summary?.mode ?? "runtime",
        total_blocked_stops: 0,
        loop_limit: limit,
        phase: summary?.phase ?? "DISCOVERY",
        blocked_agent_count: countSubmitBlockedAgents(r),
        updated_at: new Date().toISOString(),
      });
    }
  });
}

export function isAnyAgentBlocked(root?: string): boolean {
  const r = root ?? projectRoot();
  return countSubmitBlockedAgents(r) > 0;
}

/** Caller must hold goal-dir lock. Rebuild repo summary after compile invalidation. */
export async function rebuildRepoRuntimeSummaryUnlocked(root: string): Promise<void> {
  const total = await readRepoBlockedStopTotal(root);
  const limit = await readLoopLimit(root);
  const existing = await readRepoRuntimeSummary(root);
  await writeRepoRuntimeSummary(root, {
    mode: existing?.mode ?? "runtime",
    total_blocked_stops: total,
    loop_limit: limit,
    phase: existing?.phase ?? "DISCOVERY",
    blocked_agent_count: countSubmitBlockedAgents(root),
    updated_at: new Date().toISOString(),
  });
}

export { resolveAgentId, type AgentIdSource };

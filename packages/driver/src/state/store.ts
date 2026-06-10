import { createHash } from "node:crypto";
import { atomicWriteJson, readJson, runJsonPath, taskGraphPath } from "../lib/paths.js";
import {
  DEFAULT_BUDGETS,
  type GoalSpec,
  type RunState,
  type Task,
  type TaskDraft,
  type TaskGraph,
} from "./schema.js";

export function nowIso(): string {
  return new Date().toISOString();
}

function goalIdFor(spec: GoalSpec): string {
  return createHash("sha256").update(spec.goal_text).digest("hex").slice(0, 12);
}

export async function loadRun(root: string): Promise<RunState | null> {
  return readJson<RunState>(runJsonPath(root));
}

export async function saveRun(root: string, run: RunState): Promise<void> {
  run.updated_at = nowIso();
  await atomicWriteJson(runJsonPath(root), run);
}

export async function loadGraph(root: string): Promise<TaskGraph | null> {
  return readJson<TaskGraph>(taskGraphPath(root));
}

export async function saveGraph(root: string, graph: TaskGraph): Promise<void> {
  await atomicWriteJson(taskGraphPath(root), graph);
}

export function initRun(spec: GoalSpec): RunState {
  return {
    version: 1,
    goal_id: goalIdFor(spec),
    goal_spec: spec,
    status: "intake",
    global_turns: 0,
    budgets: { ...DEFAULT_BUDGETS },
    consumed: { tokens: 0, wall_ms: 0 },
    no_progress_streak: 0,
    fingerprint_ring: [],
    session_map: {},
    active_task: null,
    review_rounds_done: 0,
    escalation_reason: null,
    started_at: nowIso(),
    updated_at: nowIso(),
    driver_pid: process.pid,
  };
}

/** Promote the planner's bare task definitions into full runtime tasks. */
export function materializeGraph(graph: { tasks: TaskDraft[] }): TaskGraph {
  return {
    tasks: graph.tasks.map(
      (t): Task => ({
        id: t.id,
        title: t.title,
        kind: t.kind,
        deps: t.deps ?? [],
        acceptance_checks: t.acceptance_checks ?? [],
        acceptance_prose: t.acceptance_prose ?? "",
        status: "pending",
        attempts: 0,
        approach: "default",
        last_failure: null,
        evidence: { proof_ptrs: [], tree: null },
      }),
    ),
  };
}

export function allTasksDone(graph: TaskGraph): boolean {
  return graph.tasks.length > 0 && graph.tasks.every((t) => t.status === "done");
}

/** Next task whose deps are all done; null if none ready (done or deadlocked). */
export function pickNextReadyTask(graph: TaskGraph): Task | null {
  for (const t of graph.tasks) {
    if (t.status === "done") continue;
    const ready = t.deps.every((d) => graph.tasks.find((x) => x.id === d)?.status === "done");
    if (ready) return t;
  }
  return null;
}

export function findTask(graph: TaskGraph, id: string): Task | undefined {
  return graph.tasks.find((t) => t.id === id);
}

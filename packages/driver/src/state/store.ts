import { createHash } from "node:crypto";
import { dirtySnapshot, headSha, workingTreeFingerprint } from "../lib/git.js";
import { atomicWriteJson, readJson, runJsonPath, taskGraphPath } from "../lib/paths.js";
import { writeTextArtifact } from "../lib/progressive-reveal.js";
import {
  mergeBudgets,
  type Baseline,
  type Budgets,
  type CallCategory,
  type GoalSpec,
  type RunState,
  type Task,
  type TaskDraft,
  type TaskGraph,
} from "./schema.js";

export function nowIso(): string {
  return new Date().toISOString();
}

export function zeroTokensByCategory(): Record<CallCategory, number> {
  return { edit: 0, decompose: 0, verdict: 0, review: 0, replan: 0 };
}

function goalIdFor(spec: GoalSpec): string {
  return createHash("sha256").update(spec.goal_text).digest("hex").slice(0, 12);
}

export async function loadRun(root: string): Promise<RunState | null> {
  const run = await readJson<RunState>(runJsonPath(root));
  // run.json written before these fields existed: state stays authoritative,
  // consumers see explicit defaults rather than undefined.
  if (run && (run as { baseline?: unknown }).baseline === undefined) run.baseline = null;
  if (run) {
    run.proposed_goal_checks ??= [];
    run.consumed.tokens_by_category ??= zeroTokensByCategory();
  }
  return run;
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

/**
 * Capture the pre-run fixed point: HEAD, a snapshot of any pre-existing dirt
 * (patch + untracked list saved under evidence/baseline/), and the fingerprint.
 * Must run before the first turn — afterwards pre-run dirt and the run's own
 * work are indistinguishable.
 */
async function captureBaseline(root: string): Promise<Baseline> {
  const fingerprint = workingTreeFingerprint(root);
  const head = headSha(root);
  const snap = dirtySnapshot(root);
  let artifact: string | null = null;
  if (snap) {
    artifact = await writeTextArtifact(root, "baseline", "dirty.patch", snap.patch);
    // read back by driver/diff.ts via lib/paths.ts baselineUntrackedPath()
    await writeTextArtifact(root, "baseline", "untracked.txt", `${snap.untracked.join("\n")}\n`);
  }
  return { head_sha: head, dirty_patch_artifact: artifact, fingerprint };
}

export async function initRun(
  spec: GoalSpec,
  root: string,
  budgets?: Partial<Budgets>,
): Promise<RunState> {
  return {
    version: 1,
    goal_id: goalIdFor(spec),
    goal_spec: spec,
    baseline: await captureBaseline(root),
    status: "intake",
    global_turns: 0,
    budgets: mergeBudgets(budgets ?? {}, spec.driver_defaults),
    consumed: { tokens: 0, wall_ms: 0, tokens_by_category: zeroTokensByCategory() },
    no_progress_streak: 0,
    fingerprint_ring: [],
    session_map: {},
    active_task: null,
    review_rounds_done: 0,
    proposed_goal_checks: [],
    review_prev_material: 0,
    review_stall: 0,
    residual_findings: [],
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
        scope: t.scope ?? [],
        status: "pending",
        attempts: 0,
        approach: "default",
        last_failure: null,
        last_failure_artifact: null,
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

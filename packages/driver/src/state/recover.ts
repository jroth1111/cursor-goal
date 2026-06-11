import { workingTreeFingerprint } from "../lib/git.js";
import { appendJournal } from "../lib/journal.js";
import { loadContext, saveContext } from "../driver/context-window.js";
import { loadGraph, loadRun, saveGraph, saveRun } from "./store.js";
import type { RunState, TaskGraph } from "./schema.js";

export type Recovered = { run: RunState; graph: TaskGraph | null; resumed: boolean };

/**
 * Reconstruct a run from disk after a crash or between sessions. The on-disk
 * run.json + task-graph.json are authoritative; conversation memory is not.
 * If the active task's last recorded tree no longer matches the real tree, the
 * task is reopened for re-verification: its stale next_step is cleared so the
 * next instruction re-establishes ground truth instead of continuing a plan
 * step computed against a tree that no longer exists.
 *
 * This is THE recovery path — runGoal calls it whenever a run already exists
 * on disk (FAILURE_MODES.md row 12).
 */
export async function recover(root: string): Promise<Recovered | null> {
  const run = await loadRun(root);
  if (!run) return null;
  const graph = await loadGraph(root);

  // A terminal run is not a recovery: report it untouched, journal nothing.
  if (run.status === "done" || run.status === "escalated") {
    return { run, graph, resumed: false };
  }

  run.driver_pid = process.pid;

  if (graph && run.active_task) {
    const active = graph.tasks.find((t) => t.id === run.active_task);
    if (active && active.status === "in_progress") {
      const currentTree = workingTreeFingerprint(root);
      if (active.evidence.tree && active.evidence.tree !== currentTree) {
        const ctx = await loadContext(root, active.id);
        if (ctx.next_step) {
          ctx.next_step = "";
          await saveContext(root, ctx);
        }
        await appendJournal(root, {
          at: new Date().toISOString(),
          kind: "lifecycle",
          task_id: active.id,
          note: "tree changed since crash; reopening task for re-verification",
        });
      }
      // leave status in_progress; the loop re-runs/verifies before advancing
    }
    await saveGraph(root, graph);
  }

  await saveRun(root, run);
  await appendJournal(root, {
    at: new Date().toISOString(),
    kind: "lifecycle",
    note: `recovered run ${run.goal_id} at turn ${run.global_turns}/${run.budgets.global_turns}`,
  });
  return { run, graph, resumed: true };
}

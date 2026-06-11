import { appendJournal } from "../lib/journal.js";
import { liveLockPid, withDriverLock } from "../lib/lock.js";
import { loadGraph } from "../state/store.js";
import { loadContext, saveContext } from "./context-window.js";

export type SteerResult = { ok: boolean; message: string };

/**
 * Record one-line human guidance for a task. It lands in the task's persistent
 * context (not the task graph — guidance is advice for the next instruction, not
 * a contract change), is journaled, and is rendered as an OPERATOR GUIDANCE block
 * in every subsequent instruction for that task, surviving switch_approach.
 *
 * Lock-aware: a live driver holds the run lock for the run's duration, so steering
 * is for escalated / paused / not-yet-resumed runs — exactly the moments the
 * driver asked for a human.
 */
export async function steerTask(root: string, taskId: string, text: string): Promise<SteerResult> {
  const guidance = text.trim();
  if (!guidance) {
    return { ok: false, message: "Empty guidance — give the agent something to act on." };
  }
  const graph = await loadGraph(root);
  if (!graph) {
    return { ok: false, message: "No driver run in this repo; nothing to steer." };
  }
  const task = graph.tasks.find((t) => t.id === taskId);
  if (!task) {
    const open = graph.tasks.filter((t) => t.status !== "done").map((t) => t.id);
    return {
      ok: false,
      message: `No such task '${taskId}'. Open tasks: ${open.join(", ") || "(none)"} — agent-driver status lists all.`,
    };
  }
  if (task.status === "done") {
    return { ok: false, message: `Task ${taskId} is already done; steer a pending task or reset.` };
  }
  const pid = await liveLockPid(root);
  if (pid != null) {
    return {
      ok: false,
      message: `A driver (pid ${pid}) is mid-run and holds the lock. Pause it (Ctrl-C) or wait for escalation, then steer.`,
    };
  }

  return withDriverLock(root, async () => {
    const ctx = await loadContext(root, taskId);
    ctx.operator_guidance.push({ at: new Date().toISOString(), text: guidance });
    await saveContext(root, ctx);
    await appendJournal(root, {
      at: new Date().toISOString(),
      kind: "lifecycle",
      task_id: taskId,
      note: `operator steer: ${guidance}`,
    });
    return {
      ok: true,
      message: `Guidance recorded for ${taskId} (note ${ctx.operator_guidance.length}). It will lead the next instruction for this task.`,
    };
  });
}

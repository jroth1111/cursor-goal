import { withDriverLock } from "../lib/lock.js";
import { runTaskAcceptance, runGoalAcceptance } from "../checks/acceptance.js";
import { failingTail } from "../lib/checks.js";
import { loadGraph, loadRun, pickNextReadyTask, allTasksDone } from "../state/store.js";
import { loadContext } from "../driver/context-window.js";

export type NextActionResult = { followup_message?: string };

function buildFollowup(goalText: string, taskTitle: string, taskId: string, accept: string[], failTail: string, nextStep: string): string {
  const lines = [`[governance] Goal: ${goalText}`, `Current task (${taskId}): ${taskTitle}`];
  if (accept.length) lines.push(`Acceptance: ${accept.map((c) => `\`${c}\``).join(", ")}`);
  if (failTail) lines.push(`Last failure:\n${failTail}`);
  if (nextStep) lines.push(`Next step: ${nextStep}`);
  else lines.push("Continue toward the acceptance above, then stop.");
  return lines.join("\n");
}

/**
 * Compute the next action for an interactive session's stop hook WITHOUT spawning
 * an agent. Returns a followup_message that cursor-agent's native interactive loop
 * injects as the next user turn (ui.tsx:3833). Empty result => let the agent stop.
 * Same strategy surface as the headless loop, but the IDE pumps the turn.
 */
export async function computeNext(root: string, loopCount: number): Promise<NextActionResult> {
  return withDriverLock(root, async () => {
    const run = await loadRun(root);
    const graph = await loadGraph(root);
    if (!run || !graph) return {}; // no governed run — stay out of the way
    if (run.status === "done" || run.status === "escalated") return {};

    // honor the same global turn circuit-breaker as the headless loop (null = unlimited)
    const cap = run.budgets.global_turns;
    if (cap != null && (loopCount >= cap || run.global_turns >= cap)) {
      return {};
    }

    if (allTasksDone(graph)) {
      const goalAcceptance = await runGoalAcceptance(root, run.goal_spec);
      if (!goalAcceptance.objective || goalAcceptance.allPass) return {}; // truly done
      const tail = failingTail(goalAcceptance.results);
      return {
        followup_message: `[governance] Goal not yet met. Failing checks:\n${tail}\nFix these, then stop.`,
      };
    }

    const task = pickNextReadyTask(graph);
    if (!task) return {};

    const acceptance = await runTaskAcceptance(root, task);
    if (acceptance.objective && acceptance.allPass) {
      // this task's checks pass already; nudge toward the next one
      return {
        followup_message: `[governance] Task ${task.id} checks pass. Move to the next task toward the goal, then stop.`,
      };
    }

    const ctx = await loadContext(root, task.id);
    return {
      followup_message: buildFollowup(
        run.goal_spec.goal_text,
        task.title,
        task.id,
        task.acceptance_checks,
        failingTail(acceptance.results),
        ctx.next_step,
      ),
    };
  });
}

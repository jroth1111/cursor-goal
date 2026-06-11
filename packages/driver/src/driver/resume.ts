import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { appendJournal } from "../lib/journal.js";
import { liveLockPid, withDriverLock } from "../lib/lock.js";
import { escalationPath } from "../lib/paths.js";
import { applyBudgetOverrides, validateGraphSemantics, type RunState } from "../state/schema.js";
import { findTask, loadGraph, loadRun, saveGraph, saveRun } from "../state/store.js";
import { runGoal, type LoopOptions } from "./loop.js";
import { checkBudgets } from "./strategy.js";

export type ResumeOptions = Pick<LoopOptions, "model" | "budgets" | "call" | "progress" | "stop" | "notify" | "brainModel">;
export type ResumeOutcome =
  | { ok: false; message: string }
  | { ok: true; message: string; run: RunState };

/** Which knob raises a given budget breach (operator-facing). */
function raiseHint(reason: string): string {
  if (/turn circuit-breaker/.test(reason)) return "raise it with --max-turns N";
  if (/token budget/.test(reason)) return "raise token_budget (no CLI flag; edit run.json budgets)";
  if (/wall-clock/.test(reason)) return "raise wall_ms (no CLI flag; edit run.json budgets)";
  return "raise the relevant budget";
}

/**
 * Continue an escalated or paused run. Escalation was a deliberate stop — the
 * driver asking a human — so continuing is an explicit verb, never an accident
 * of re-running `run`. Honors operator edits to task-graph.json (validated
 * before continuing) and resets the stuck task's attempt counter and the
 * progress detectors, since the usual escalation causes would otherwise
 * re-trigger instantly.
 */
export async function resumeRun(root: string, opts: ResumeOptions = {}): Promise<ResumeOutcome> {
  const run = await loadRun(root);
  if (!run) {
    return { ok: false, message: "No driver run in this repo; nothing to resume." };
  }
  if (run.status === "done") {
    return { ok: false, message: "Run already done — use 'agent-driver reset' to start a new goal." };
  }
  const pid = await liveLockPid(root);
  if (pid != null) {
    return { ok: false, message: `A driver (pid ${pid}) is already running this repo.` };
  }

  if (run.status === "escalated") {
    const graph = await loadGraph(root);
    if (graph) {
      // operators hand-edit task-graph.json between escalation and resume — fail helpfully
      const invalid = validateGraphSemantics(graph, run.goal_spec.scope);
      if (invalid) {
        return { ok: false, message: `task-graph.json is invalid after edits: ${invalid}` };
      }
    }

    // a budget-breach escalation resumed with the same budget re-escalates on the
    // first loop iteration — refuse with the exact fix instead of a wasted invocation.
    // applyBudgetOverrides is the SAME merge the loop will apply, so the probe's
    // verdict cannot diverge from the budgets the resumed run actually gets.
    const probe: RunState = { ...run, budgets: applyBudgetOverrides(run.budgets, opts.budgets) };
    const stillBreached = checkBudgets(probe);
    if (stillBreached.breached) {
      return {
        ok: false,
        message: `Still over budget (${stillBreached.reason}) — ${raiseHint(stillBreached.reason ?? "")}.`,
      };
    }

    await withDriverLock(root, async () => {
      const reason = run.escalation_reason ?? "(no reason recorded)";
      if (run.active_task && graph) {
        const stuck = findTask(graph, run.active_task);
        if (stuck && stuck.status !== "done") {
          stuck.attempts = 0; // the attempt budget was the usual escalation cause
          await saveGraph(root, graph);
        }
      }
      run.no_progress_streak = 0;
      run.fingerprint_ring = []; // pre-escalation history must not re-trigger detectors
      run.escalation_reason = null;
      run.status = "running";
      await saveRun(root, run);
      if (existsSync(escalationPath(root))) await rm(escalationPath(root)).catch(() => undefined);
      const md = escalationPath(root).replace(/\.json$/, ".md");
      if (existsSync(md)) await rm(md).catch(() => undefined);
      await appendJournal(root, {
        at: new Date().toISOString(),
        kind: "lifecycle",
        note: `resumed from escalation: ${reason}`,
      });
    });
  } else if (run.status === "paused") {
    await withDriverLock(root, async () => {
      run.status = "running";
      await saveRun(root, run);
      await appendJournal(root, { at: new Date().toISOString(), kind: "lifecycle", note: "resumed from pause" });
    });
  }
  // any other state (running after a crash, decomposed, intake): runGoal's
  // recovery path handles it directly

  const result = await runGoal({ root, ...opts });
  return { ok: true, message: `resume finished with status ${result.status}`, run: result };
}

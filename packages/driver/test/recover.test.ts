import { afterEach, describe, expect, it } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { recover } from "../src/state/recover.js";
import { initRun, saveGraph, saveRun, materializeGraph } from "../src/state/store.js";
import { loadContext, saveContext } from "../src/driver/context-window.js";
import { runGoal } from "../src/driver/loop.js";
import { readJournalTail } from "../src/lib/journal.js";
import { journalPath } from "../src/lib/paths.js";
import type { TurnResult } from "../src/agent/runner.js";
import { mkGitProject, type Project } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("crash recovery", () => {
  it("returns null when there is no run on disk", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    expect(await recover(p.root)).toBeNull();
  });

  it("reconstructs a running run and reopens a stale in-progress task", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    const run = await initRun({ goal_text: "g", source: "prompt", acceptance_checks: [], non_goals: [], scope: [] }, p.root);
    run.status = "running";
    run.global_turns = 2;
    run.active_task = "t1";
    await saveRun(p.root, run);
    const graph = materializeGraph({
      tasks: [{ id: "t1", title: "x", kind: "implement", deps: [], acceptance_checks: ["true"], acceptance_prose: "" }],
    });
    graph.tasks[0].status = "in_progress";
    graph.tasks[0].evidence.tree = "stale-fingerprint-that-no-longer-matches";
    await saveGraph(p.root, graph);
    // mutate the tree so the recorded fingerprint is stale
    writeFileSync(path.join(p.root, "new.txt"), "changed after crash");

    const rec = await recover(p.root);
    expect(rec).not.toBeNull();
    expect(rec?.run.global_turns).toBe(2);
    expect(rec?.run.driver_pid).toBe(process.pid);
    const journal = await readJournalTail(p.root, 20);
    expect(journal.some((e) => /reopening task for re-verification/.test(e.note ?? ""))).toBe(true);
  });

  it("clears the reopened task's stale next_step so ground truth is re-established", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    const run = await initRun({ goal_text: "g", source: "prompt", acceptance_checks: [], non_goals: [], scope: [] }, p.root);
    run.status = "running";
    run.active_task = "t1";
    await saveRun(p.root, run);
    const graph = materializeGraph({
      tasks: [{ id: "t1", title: "x", kind: "implement", deps: [], acceptance_checks: ["true"], acceptance_prose: "" }],
    });
    graph.tasks[0].status = "in_progress";
    graph.tasks[0].evidence.tree = "stale";
    await saveGraph(p.root, graph);
    const ctx = await loadContext(p.root, "t1");
    ctx.next_step = "step computed against the pre-crash tree";
    await saveContext(p.root, ctx);
    writeFileSync(path.join(p.root, "new.txt"), "post-crash mutation");

    await recover(p.root);
    expect((await loadContext(p.root, "t1")).next_step).toBe("");
  });

  it("terminal runs are reported untouched: no journal entry, resumed=false", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    const run = await initRun({ goal_text: "g", source: "prompt", acceptance_checks: [], non_goals: [], scope: [] }, p.root);
    run.status = "done";
    await saveRun(p.root, run);

    const rec = await recover(p.root);
    expect(rec?.resumed).toBe(false);
    expect(rec?.run.status).toBe("done");
    expect(existsSync(journalPath(p.root))).toBe(false); // nothing journaled
  });
});

describe("crash recovery through the real run path", () => {
  it("runGoal on crashed state reopens the stale task, drops its next_step, and completes", async () => {
    const goalMd = "# Goal\n\n## Goal\nCrash sim\n\n## Checks\n\n- `test -f out.txt`\n";
    const p: Project = mkGitProject({ "GOAL.md": goalMd });
    cleanups.push(p.cleanup);

    // persist a mid-run snapshot as a crashed driver left it
    const run = await initRun(
      { goal_text: "Crash sim", source: "GOAL.md", acceptance_checks: ["test -f out.txt"], non_goals: [], scope: [] },
      p.root,
    );
    run.status = "running";
    run.global_turns = 3;
    run.active_task = "t1";
    await saveRun(p.root, run);
    const graph = materializeGraph({
      tasks: [{ id: "t1", title: "make out.txt", kind: "implement", deps: [], acceptance_checks: ["test -f out.txt"], acceptance_prose: "" }],
    });
    graph.tasks[0].status = "in_progress";
    graph.tasks[0].evidence.tree = "tree-recorded-before-the-crash";
    await saveGraph(p.root, graph);
    const ctx = await loadContext(p.root, "t1");
    ctx.next_step = "STALE-STEP-FROM-BEFORE-CRASH";
    await saveContext(p.root, ctx);
    // post-crash human edit makes the recorded tree stale
    writeFileSync(path.join(p.root, "edited-by-human.txt"), "while the driver was down");

    const instructions: string[] = [];
    const call = async (opts: { instruction: string; mode?: string }): Promise<TurnResult> => {
      if (opts.mode === "ask") {
        return { sessionId: "ask", finalText: "{}", usage: null, terminal: "success", exitCode: 0, timedOut: false };
      }
      instructions.push(opts.instruction);
      writeFileSync(path.join(p.root, "out.txt"), "done");
      return { sessionId: "s", finalText: "done", usage: null, terminal: "success", exitCode: 0, timedOut: false };
    };

    const result = await runGoal({ root: p.root, budgets: { global_turns: 6, review_rounds: 0 }, call });
    expect(result.status).toBe("done");
    expect(result.global_turns).toBeGreaterThan(3); // resumed the counted run, not a fresh one

    // the stale step never reached the agent — ground truth was re-established
    expect(instructions[0]).not.toContain("STALE-STEP-FROM-BEFORE-CRASH");

    const journal = await readJournalTail(p.root, 50);
    expect(journal.some((e) => /reopening task for re-verification/.test(e.note ?? ""))).toBe(true);
    expect(journal.some((e) => /recovered run/.test(e.note ?? ""))).toBe(true);
    // acceptance genuinely re-ran before completion
    expect(journal.some((e) => e.kind === "decision" && e.decision === "task_done")).toBe(true);
  });
});

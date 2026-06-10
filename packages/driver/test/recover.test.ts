import { afterEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { recover } from "../src/state/recover.js";
import { initRun, saveGraph, saveRun, materializeGraph } from "../src/state/store.js";
import { readJournalTail } from "../src/lib/journal.js";
import { mkGitProject } from "./helpers.js";

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
    const run = initRun({ goal_text: "g", source: "prompt", acceptance_checks: [], non_goals: [], scope: [] });
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
});

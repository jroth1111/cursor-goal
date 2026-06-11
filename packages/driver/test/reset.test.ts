import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runGoal } from "../src/driver/loop.js";
import { archivedRunCount, resetRun } from "../src/driver/reset.js";
import { driverDir, runsDir } from "../src/lib/paths.js";
import { loadRun } from "../src/state/store.js";
import { mkGitProject, scenarioEnv, withEnv, type Project, type Scenario } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function project(): Project {
  const goalMd = "# Goal\n\n## Goal\nReset test\n\n## Checks\n\n- `test -f made.txt`\n";
  const p = mkGitProject({ "GOAL.md": goalMd });
  cleanups.push(p.cleanup);
  return p;
}

const scenario: Scenario = {
  plan: { tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: ["test -f made.txt"], acceptance_prose: "" }] },
  turns: [{ mutate: [{ file: "made.txt", content: "x" }] }],
};

async function runToDone(p: Project, tag: string): Promise<void> {
  const result = await withEnv(scenarioEnv(p.root, scenario, tag), () =>
    runGoal({ root: p.root, budgets: { global_turns: 4, review_rounds: 0 } }),
  );
  expect(result.status).toBe("done");
}

describe("agent-driver reset", () => {
  it("archives the full run state and allows a fresh second run", async () => {
    const p = project();
    await runToDone(p, "r1");

    const result = await resetRun(p.root);
    expect(result.ok).toBe(true);
    expect(result.archiveDir).toBeTruthy();
    // archive holds the run's state
    const archived = readdirSync(result.archiveDir!);
    expect(archived).toContain("run.json");
    expect(archived).toContain("task-graph.json");
    expect(archived).toContain("journal.jsonl");
    expect(archived).toContain("evidence");
    // live dir is clean of run state
    expect(await loadRun(p.root)).toBeNull();
    const live = readdirSync(driverDir(p.root));
    expect(live.filter((e) => e !== "runs" && e !== ".lock")).toEqual([]);
    expect(await archivedRunCount(p.root)).toBe(1);

    // a brand-new goal runs from scratch (fresh fake-agent state via new tag)
    await runToDone(p, "r1b");
    expect((await loadRun(p.root))?.status).toBe("done");
  });

  it("--keep-evidence leaves evidence/ in place", async () => {
    const p = project();
    await runToDone(p, "r2");
    const result = await resetRun(p.root, { keepEvidence: true });
    expect(result.ok).toBe(true);
    expect(existsSync(path.join(driverDir(p.root), "evidence"))).toBe(true);
    expect(readdirSync(result.archiveDir!)).not.toContain("evidence");
  });

  it("refuses while a live pid holds the lock", async () => {
    const p = project();
    await runToDone(p, "r3");
    const lockDir = path.join(driverDir(p.root), ".lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      path.join(lockDir, "owner.json"),
      JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }),
    );
    const result = await resetRun(p.root);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(new RegExp(`pid ${process.pid}`));
    // nothing moved
    expect(await loadRun(p.root)).not.toBeNull();
  });

  it("refuses when there is no run", async () => {
    const p = project();
    const result = await resetRun(p.root);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/No driver run/);
  });

  it("archive names never collide", async () => {
    const p = project();
    await runToDone(p, "r5");
    const run = await loadRun(p.root);
    const ts = run!.started_at.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    // pre-create the natural archive name to force the suffix path
    mkdirSync(path.join(runsDir(p.root), `${ts}-${run!.goal_id}`), { recursive: true });
    const result = await resetRun(p.root);
    expect(result.ok).toBe(true);
    expect(result.archiveDir!).toMatch(/-2$/);
  });
});

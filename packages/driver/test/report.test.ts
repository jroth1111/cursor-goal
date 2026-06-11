import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runGoal } from "../src/driver/loop.js";
import { steerTask } from "../src/driver/steer.js";
import { buildRunReport, writeRunReport } from "../src/driver/report.js";
import { initRun, saveRun } from "../src/state/store.js";
import { mkGitProject, scenarioEnv, withEnv, type Project, type Scenario } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function project(): Project {
  const goalMd =
    "# Goal\n\n## Goal\nReport test goal\n\n## Checks\n\n- `test -f one.txt`\n- `test -f two.txt`\n";
  const p = mkGitProject({ "GOAL.md": goalMd, "tracked.txt": "before\n" });
  cleanups.push(p.cleanup);
  return p;
}

describe("agent-driver report", () => {
  it("done run: summary, per-task narrative with decision trail and evidence, quality, changes", async () => {
    const p = project();
    const scenario: Scenario = {
      plan: {
        tasks: [
          { id: "t1", title: "make one", kind: "implement", deps: [], acceptance_checks: ["test -f one.txt"], acceptance_prose: "" },
          { id: "t2", title: "make two", kind: "implement", deps: ["t1"], acceptance_checks: ["test -f two.txt"], acceptance_prose: "" },
        ],
      },
      verdicts: [{ task_complete: false, confidence: 0.3, blockers: [], next_action: { kind: "continue", instruction: "write two.txt" } }],
      turns: [
        { mutate: [{ file: "one.txt", content: "1" }, { file: "tracked.txt", content: "after\n" }] },
        { delta: "thinking about two" }, // t2 attempt 1: checks fail -> continue
        { mutate: [{ file: "two.txt", content: "2" }] },
      ],
    };
    const run = await withEnv(scenarioEnv(p.root, scenario, "rp1"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 8, review_rounds: 0 } }),
    );
    expect(run.status).toBe("done");

    const written = await writeRunReport(p.root);
    expect(written.ok).toBe(true);
    expect(existsSync(path.join(p.root, "RUN_REPORT.md"))).toBe(true);
    const md = readFileSync(path.join(p.root, "RUN_REPORT.md"), "utf8");

    expect(md).toMatch(/# Run report — Report test goal/);
    expect(md).toMatch(/status: \*\*done\*\*/);
    expect(md).toMatch(/turns: 3\/8/);
    expect(md).toMatch(/`test -f one\.txt`; `test -f two\.txt`/);

    // per-task narrative
    expect(md).toMatch(/### ✓ t1 — make one/);
    expect(md).toMatch(/### ✓ t2 — make two/);
    expect(md).toMatch(/decision trail: continue_same_session → task_done/); // t2's trail
    expect(md).toMatch(/evidence: .*turns\/1-t1\.jsonl/); // transcripts as evidence

    // quality + changes
    expect(md).toMatch(/review_rounds 0|review skipped|adversarial review skipped/);
    expect(md).toMatch(/tracked\.txt/); // tracked edit in the diff stat
    expect(md).toMatch(/new files: .*one\.txt/);
  });

  it("escalated run: reason in summary, stuck task failure + guidance noted", async () => {
    const p = project();
    const scenario: Scenario = {
      plan: { tasks: [{ id: "t1", title: "stuck", kind: "implement", deps: [], acceptance_checks: ["test -f one.txt"], acceptance_prose: "" }] },
      turns: [{ result: "error", delta: "kaboom" }],
    };
    const run = await withEnv(scenarioEnv(p.root, scenario, "rp2"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 6, task_attempts: 1, review_rounds: 0 } }),
    );
    expect(run.status).toBe("escalated");
    await steerTask(p.root, "t1", "look at the fixture");

    const built = await buildRunReport(p.root);
    expect(built.ok).toBe(true);
    const md = built.content!;
    expect(md).toMatch(/status: \*\*escalated\*\* — task t1 failed/);
    expect(md).toMatch(/### ○ t1 — stuck/);
    expect(md).toMatch(/last failure: kaboom/);
    expect(md).toMatch(/full: \.cursor\/goal\/driver\/evidence\/turn-failures/);
    expect(md).toMatch(/operator guidance given: 1 note/);
  });

  it("tolerates partial runs and rotated evidence", async () => {
    const p = project();
    // run.json only — no graph, no journal, no baseline
    const run = await initRun({ goal_text: "partial", source: "prompt", acceptance_checks: [], non_goals: [], scope: [] }, p.root);
    run.baseline = null; // simulate a pre-baseline run
    await saveRun(p.root, run);
    const built = await buildRunReport(p.root);
    expect(built.ok).toBe(true);
    expect(built.content).toMatch(/no task graph yet/);
    expect(built.content).toMatch(/no baseline recorded/);
    expect(built.content).toMatch(/goal acceptance: none/);

    // a rotated (deleted) evidence pointer renders as such rather than lying
    const p2 = project();
    const scenario: Scenario = {
      plan: { tasks: [{ id: "t1", title: "t", kind: "implement", deps: [], acceptance_checks: ["test -f one.txt"], acceptance_prose: "" }] },
      turns: [{ mutate: [{ file: "one.txt", content: "1" }, { file: "two.txt", content: "2" }] }],
    };
    await withEnv(scenarioEnv(p2.root, scenario, "rp3"), () =>
      runGoal({ root: p2.root, budgets: { global_turns: 4, review_rounds: 0 } }),
    );
    const transcript = path.join(p2.root, ".cursor/goal/driver/evidence/turns/1-t1.jsonl");
    expect(existsSync(transcript)).toBe(true);
    writeFileSync(transcript + ".keep", ""); // ensure dir stays
    const { rmSync } = await import("node:fs");
    rmSync(transcript);
    const built2 = await buildRunReport(p2.root);
    expect(built2.content).toMatch(/1-t1\.jsonl \(rotated\)/);
  });

  it("no run explains itself", async () => {
    const p = project();
    const built = await buildRunReport(p.root);
    expect(built.ok).toBe(false);
    expect(built.message).toMatch(/No driver run/);
  });
});

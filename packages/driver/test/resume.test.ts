import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { runGoal } from "../src/driver/loop.js";
import { resumeRun } from "../src/driver/resume.js";
import { readJournalTail } from "../src/lib/journal.js";
import { escalationPath } from "../src/lib/paths.js";
import { loadGraph, loadRun, saveGraph, saveRun } from "../src/state/store.js";
import { mkGitProject, scenarioEnv, withEnv, type Project, type Scenario } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function project(check: string): Project {
  const goalMd = `# Goal\n\n## Goal\nResume test\n\n## Checks\n\n- \`${check}\`\n`;
  const p = mkGitProject({ "GOAL.md": goalMd });
  cleanups.push(p.cleanup);
  return p;
}

function plan(check: string) {
  return { tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: [check], acceptance_prose: "" }] };
}

describe("agent-driver resume", () => {
  it("escalated run resumes after attempt reset and completes; ESCALATION.json removed", async () => {
    const p = project("test -f ok.txt");
    const scenario: Scenario = {
      plan: plan("test -f ok.txt"),
      turns: [
        { result: "error" },
        { result: "error" }, // two failures exhaust task_attempts=2 -> escalate
        { result: "error" }, // post-resume failure: must NOT re-escalate (attempts were reset)
        { mutate: [{ file: "ok.txt", content: "x" }] },
      ],
    };
    const env = scenarioEnv(p.root, scenario, "rs1");
    const first = await withEnv(env, () =>
      runGoal({ root: p.root, budgets: { global_turns: 10, task_attempts: 2, review_rounds: 0 } }),
    );
    expect(first.status).toBe("escalated");
    expect(existsSync(escalationPath(p.root))).toBe(true);

    const outcome = await withEnv(env, () => resumeRun(p.root));
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.run.status).toBe("done");
    expect(existsSync(escalationPath(p.root))).toBe(false);
    expect((await loadRun(p.root))?.escalation_reason).toBeNull();

    const journal = await readJournalTail(p.root, 60);
    expect(journal.some((e) => /resumed from escalation/.test(e.note ?? ""))).toBe(true);
  });

  it("budget-breach escalation refuses without a raise and names the flag; raised budget resumes", async () => {
    const p = project("test -f ok.txt");
    const scenario: Scenario = {
      plan: plan("test -f ok.txt"),
      verdicts: [{ task_complete: false, confidence: 0.2, blockers: [], next_action: { kind: "continue", instruction: "keep going" } }],
      turns: [{ delta: "no progress" }, { mutate: [{ file: "ok.txt", content: "x" }] }],
    };
    const env = scenarioEnv(p.root, scenario, "rs2");
    const first = await withEnv(env, () =>
      runGoal({ root: p.root, budgets: { global_turns: 1, review_rounds: 0 } }),
    );
    expect(first.status).toBe("escalated");
    expect(first.escalation_reason).toMatch(/turn circuit-breaker/);

    const refused = await withEnv(env, () => resumeRun(p.root));
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/--max-turns/);

    const raised = await withEnv(env, () => resumeRun(p.root, { budgets: { global_turns: 6 } }));
    expect(raised.ok).toBe(true);
    expect(raised.ok && raised.run.status).toBe("done");
  });

  it("paused run resumes", async () => {
    const p = project("test -f ok.txt");
    const scenario: Scenario = {
      plan: plan("test -f ok.txt"),
      turns: [
        { mutate: [{ file: "ok.txt", content: "x" }] },
        { mutate: [{ file: "resumed-work.txt", content: "x" }] }, // the post-resume turn progresses
      ],
    };
    const env = scenarioEnv(p.root, scenario, "rs3");
    // create a run then mark it paused (the SIGINT path will produce this state)
    const first = await withEnv(env, () =>
      runGoal({ root: p.root, budgets: { global_turns: 5, review_rounds: 0 } }),
    );
    // first run actually completed; rewind it to paused with an open task to simulate
    const run = (await loadRun(p.root))!;
    run.status = "paused";
    await saveRun(p.root, run);
    const graph = (await loadGraph(p.root))!;
    graph.tasks[0].status = "pending";
    graph.tasks[0].attempts = 0;
    await saveGraph(p.root, graph);
    expect(first.status).toBe("done");

    const outcome = await withEnv(env, () => resumeRun(p.root));
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.run.status).toBe("done");
    const journal = await readJournalTail(p.root, 30);
    expect(journal.some((e) => /resumed from pause/.test(e.note ?? ""))).toBe(true);
  });

  it("done and missing runs refuse with clear messages", async () => {
    const p = project("true");
    expect((await resumeRun(p.root)).message).toMatch(/No driver run/);
    const scenario: Scenario = { plan: plan("true"), turns: [{ mutate: [{ file: "a.txt", content: "x" }] }] };
    await withEnv(scenarioEnv(p.root, scenario, "rs4"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 3, review_rounds: 0 } }),
    );
    const done = await resumeRun(p.root);
    expect(done.ok).toBe(false);
    expect(done.message).toMatch(/already done.*reset/);
  });

  it("refuses when operator edits broke the task graph", async () => {
    const p = project("test -f never.txt");
    const scenario: Scenario = { plan: plan("test -f never.txt"), turns: [{ result: "error" }] };
    const env = scenarioEnv(p.root, scenario, "rs5");
    const first = await withEnv(env, () =>
      runGoal({ root: p.root, budgets: { global_turns: 4, task_attempts: 1, review_rounds: 0 } }),
    );
    expect(first.status).toBe("escalated");
    const graph = (await loadGraph(p.root))!;
    graph.tasks[0].deps = ["does-not-exist"];
    await saveGraph(p.root, graph);

    const outcome = await resumeRun(p.root);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/task-graph\.json is invalid/);
    expect(outcome.message).toMatch(/does-not-exist/);
  });
});

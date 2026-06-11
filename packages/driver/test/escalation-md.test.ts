import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { runGoal } from "../src/driver/loop.js";
import { resumeRun } from "../src/driver/resume.js";
import { steerTask } from "../src/driver/steer.js";
import { escalationPath } from "../src/lib/paths.js";
import { mkGitProject, scenarioEnv, withEnv, type Project, type Scenario } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function project(): Project {
  const goalMd = "# Goal\n\n## Goal\nEscalation handoff test goal\n\n## Checks\n\n- `test -f one.txt`\n- `test -f two.txt`\n";
  const p = mkGitProject({ "GOAL.md": goalMd });
  cleanups.push(p.cleanup);
  return p;
}

const scenario: Scenario = {
  plan: {
    tasks: [
      { id: "t1", title: "make one", kind: "implement", deps: [], acceptance_checks: ["test -f one.txt"], acceptance_prose: "" },
      { id: "t2", title: "make two", kind: "implement", deps: ["t1"], acceptance_checks: ["test -f two.txt"], acceptance_prose: "" },
    ],
  },
  turns: [
    { mutate: [{ file: "one.txt", content: "x" }] }, // t1 done
    { result: "error", delta: "exploded while making two" }, // t2 fails…
    { result: "error", delta: "exploded again" }, // …to its attempt cap
    { mutate: [{ file: "two.txt", content: "x" }] }, // post-resume success
  ],
};

describe("ESCALATION.md handoff", () => {
  it("written on escalate with the stuck task's story and the literal next commands; resume removes it", async () => {
    const p = project();
    const env = scenarioEnv(p.root, scenario, "em1");
    const run = await withEnv(env, () =>
      runGoal({ root: p.root, budgets: { global_turns: 10, task_attempts: 2, review_rounds: 0 } }),
    );
    expect(run.status).toBe("escalated");

    const mdPath = escalationPath(p.root).replace(/\.json$/, ".md");
    expect(existsSync(mdPath)).toBe(true);
    const md = readFileSync(mdPath, "utf8");

    // why + cost
    expect(md).toMatch(/## Why/);
    expect(md).toMatch(/agent error\/abort|attempt budget/);
    expect(md).toMatch(/## What it cost/);
    expect(md).toMatch(/turns 3\/10/);

    // the stuck task's story: attempts, tried approaches, failure preview, acceptance
    expect(md).toMatch(/### t2 — make two/);
    expect(md).toMatch(/attempts: 2 of 2/);
    expect(md).toMatch(/tried approaches:/);
    expect(md).toMatch(/smaller, safer first step/); // onAgentFailure's switch instruction
    expect(md).toMatch(/`test -f two\.txt`/);
    expect(md).toMatch(/exploded/);

    // the done task is summarized, not detailed
    expect(md).not.toMatch(/### t1/);
    expect(md).toMatch(/1 task\(s\) already done: t1/);

    // all four next commands, targeting the stuck task
    expect(md).toMatch(/agent-driver logs --task t2/);
    expect(md).toMatch(/agent-driver steer t2/);
    expect(md).toMatch(/agent-driver resume/);
    expect(md).toMatch(/agent-driver reset/);

    // steering shows up if the operator already left guidance, then resume clears the handoff
    await steerTask(p.root, "t2", "two.txt only needs to exist");
    const outcome = await withEnv(env, () => resumeRun(p.root));
    expect(outcome.ok && outcome.run.status).toBe("done");
    expect(existsSync(mdPath)).toBe(false);
    expect(existsSync(escalationPath(p.root))).toBe(false);
  });

  it("failure previews stay previews — huge failures point at the artifact instead of flooding the handoff", async () => {
    const p = project();
    const big = "E".repeat(20_000);
    const bigScenario: Scenario = {
      ...scenario,
      turns: [
        { mutate: [{ file: "one.txt", content: "x" }] },
        { result: "error", delta: big },
        { result: "error", delta: big },
      ],
    };
    const run = await withEnv(scenarioEnv(p.root, bigScenario, "em2"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 10, task_attempts: 2, review_rounds: 0 } }),
    );
    expect(run.status).toBe("escalated");
    const md = readFileSync(escalationPath(p.root).replace(/\.json$/, ".md"), "utf8");
    expect(md.length).toBeLessThan(10_000); // preview, not the 20k payload
    expect(md).toMatch(/full output: \.cursor\/goal\/driver\/evidence\/turn-failures/);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runGoal } from "../src/driver/loop.js";
import { buildRunReport } from "../src/driver/report.js";
import { runJsonPath, writeJson } from "../src/lib/paths.js";
import { loadRun } from "../src/state/store.js";
import type { CallCategory, RunState } from "../src/state/schema.js";
import { mkGitProject, scenarioEnv, withEnv, type Project, type Scenario } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function project(check: string): Project {
  const goalMd = `# Goal\n\n## Goal\nToken accounting\n\n## Checks\n\n- \`${check}\`\n`;
  const p = mkGitProject({ "GOAL.md": goalMd });
  cleanups.push(p.cleanup);
  return p;
}

function sumByCategory(run: RunState): number {
  return Object.values(run.consumed.tokens_by_category).reduce((a, b) => a + b, 0);
}

// the fake agent reports 30 tokens per call (10 in + 20 out)
const PER_CALL = 30;

describe("token accounting by category", () => {
  it("edit/decompose/verdict/review tokens all land in their buckets; sum equals the legacy total", async () => {
    const p = project("test -f out.txt");
    const scenario: Scenario = {
      plan: { tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: ["test -f out.txt"], acceptance_prose: "" }] },
      verdicts: [{ task_complete: false, confidence: 0.3, blockers: [], next_action: { kind: "continue", instruction: "write it" } }],
      reviews: [{ satisfied: true, findings: [] }],
      turns: [
        { delta: "no file yet" }, // edit turn 1; checks fail -> verdict consulted
        { mutate: [{ file: "out.txt", content: "x" }] }, // edit turn 2 -> objective done
      ],
    };
    const run = await withEnv(scenarioEnv(p.root, scenario, "tk1"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 6, review_rounds: 2 } }),
    );
    expect(run.status).toBe("done");

    const cat = run.consumed.tokens_by_category;
    expect(cat.decompose).toBe(PER_CALL); // one planner call
    expect(cat.edit).toBe(2 * PER_CALL); // two edit turns
    expect(cat.verdict).toBe(PER_CALL); // consulted once (turn 2 was objective)
    expect(cat.review).toBe(PER_CALL); // one satisfied review round
    expect(cat.replan).toBe(0);
    expect(sumByCategory(run)).toBe(run.consumed.tokens); // the invariant
    expect(run.consumed.tokens).toBe(5 * PER_CALL);

    // the report surfaces the breakdown
    const report = await buildRunReport(p.root);
    expect(report.content).toMatch(/tokens: 150 \(edit 60 · decompose 30 · verdict 30 · review 30\)/);
  });

  it("replan tokens are accounted", async () => {
    const p = project("test -f out.txt");
    const scenario: Scenario = {
      plan: { tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: ["test -f out.txt"], acceptance_prose: "" }] },
      replan: { tasks: [{ id: "sub", title: "sub", kind: "implement", deps: [], acceptance_checks: ["test -f out.txt"], acceptance_prose: "" }] },
      verdicts: [{ task_complete: false, confidence: 0.2, blockers: [], next_action: { kind: "replan", instruction: "split it" } }],
      turns: [
        // deltas may say anything — the stub routes on the prompt HEAD now, so
        // agent text embedded in the verdict prompt can no longer hijack routing
        { delta: "stuck on this subtask" }, // t1: checks fail, verdict says replan
        { mutate: [{ file: "out.txt", content: "x" }] }, // t1.sub completes
        { delta: "integration pass" }, // t1 (now integrate) re-verifies
      ],
    };
    const run = await withEnv(scenarioEnv(p.root, scenario, "tk2"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 8, review_rounds: 0 } }),
    );
    expect(run.status).toBe("done");
    expect(run.consumed.tokens_by_category.replan).toBe(PER_CALL);
    expect(sumByCategory(run)).toBe(run.consumed.tokens);
  });

  it("backward compat: old run.json without the breakdown loads zeroed and keeps working", async () => {
    const p = project("test -f out.txt");
    const scenario: Scenario = {
      plan: { tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: ["test -f out.txt"], acceptance_prose: "" }] },
      turns: [{ mutate: [{ file: "out.txt", content: "x" }] }],
    };
    await withEnv(scenarioEnv(p.root, scenario, "tk3"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 4, review_rounds: 0 } }),
    );
    const raw = JSON.parse(readFileSync(runJsonPath(p.root), "utf8")) as { consumed: Record<string, unknown> };
    delete raw.consumed.tokens_by_category;
    await writeJson(runJsonPath(p.root), raw);

    const loaded = (await loadRun(p.root))!;
    const zeroed = loaded.consumed.tokens_by_category;
    for (const k of ["edit", "decompose", "verdict", "review", "replan"] as CallCategory[]) {
      expect(zeroed[k]).toBe(0);
    }
    expect(loaded.consumed.tokens).toBeGreaterThan(0); // legacy total untouched
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { runGoal } from "../src/driver/loop.js";
import { readJournalTail } from "../src/lib/journal.js";
import { getVerdict } from "../src/driver/verdict.js";
import { emptyContext } from "../src/driver/context-window.js";
import { mkGitProject, scenarioEnv, withEnv, type Project, type Scenario } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function project(goalChecks: string[], seed: Record<string, string> = {}): Project {
  const goalMd = `# Goal\n\n## Goal\nTest goal\n\n## Checks\n\n${goalChecks.map((c) => `- \`${c}\``).join("\n")}\n`;
  const p = mkGitProject({ "GOAL.md": goalMd, ...seed });
  cleanups.push(p.cleanup);
  return p;
}

function task(id: string, checks: string[]) {
  return { id, title: id, kind: "implement" as const, deps: [] as string[], acceptance_checks: checks, acceptance_prose: "" };
}

async function run(root: string, scenario: Scenario, budgets?: Record<string, number>, tag = "s") {
  return withEnv(scenarioEnv(root, scenario, tag), () => runGoal({ root, budgets }));
}

describe("driver outer loop", () => {
  it("happy path: decompose -> edit -> checks pass -> done", async () => {
    const p = project(["test -f made.txt"]);
    const scenario: Scenario = {
      plan: { tasks: [task("t1", ["test -f made.txt"])] },
      turns: [{ mutate: [{ file: "made.txt", content: "hi" }], delta: "made it" }],
    };
    const result = await run(p.root, scenario);
    expect(result.status).toBe("done");
    expect(existsSync(path.join(p.root, "made.txt"))).toBe(true);
    const journal = await readJournalTail(p.root, 50);
    expect(journal.some((e) => e.kind === "decision" && e.decision === "task_done")).toBe(true);
  });

  it("agent error with attempt budget exhausted -> escalate (does NOT mark done)", async () => {
    const p = project(["test -f never.txt"]);
    const scenario: Scenario = {
      plan: { tasks: [task("t1", ["test -f never.txt"])] },
      turns: [{ result: "error" }],
    };
    const result = await run(p.root, scenario, { task_attempts: 1 });
    expect(result.status).toBe("escalated");
    expect(result.escalation_reason).toMatch(/agent error\/abort/);
    expect(existsSync(path.join(p.root, ".cursor/goal/driver/ESCALATION.json"))).toBe(true);
  });

  it("global turn budget exhaustion -> escalate", async () => {
    const p = project(["test -f never.txt"]);
    const scenario: Scenario = {
      plan: { tasks: [task("t1", ["test -f never.txt"])] },
      verdicts: [{ task_complete: false, confidence: 0.2, blockers: [], next_action: { kind: "continue", instruction: "again" } }],
      turns: [
        { mutate: [{ file: "a.txt", content: "1" }] },
        { mutate: [{ file: "b.txt", content: "2" }] },
        { mutate: [{ file: "c.txt", content: "3" }] },
      ],
    };
    const result = await run(p.root, scenario, { global_turns: 3, task_attempts: 10 });
    expect(result.status).toBe("escalated");
    expect(result.escalation_reason).toMatch(/global turn budget/);
    expect(result.global_turns).toBe(3);
  });

  it("oscillation (A->B->A) forces a switch_approach decision", async () => {
    const p = project(["test -f goal_done.txt"]);
    const scenario: Scenario = {
      plan: { tasks: [task("t1", ["test -f goal_done.txt"])] },
      verdicts: [{ task_complete: false, confidence: 0.2, blockers: [], next_action: { kind: "continue", instruction: "again" } }],
      turns: [
        { mutate: [{ file: "a.txt", content: "1" }] },
        { mutate: [{ file: "a.txt", content: "2" }] },
        { mutate: [{ file: "a.txt", content: "1" }] },
      ],
    };
    const result = await run(p.root, scenario, { global_turns: 6, task_attempts: 10 });
    const journal = await readJournalTail(p.root, 60);
    const switched = journal.some((e) => e.kind === "decision" && e.decision === "switch_approach" && /oscillation/.test(e.note ?? ""));
    expect(switched).toBe(true);
    expect(result.status).toBe("escalated"); // never satisfies the goal check
  });

  it("non-objective task: honors a clean verdict of complete", async () => {
    const p = project([]); // no goal-level checks
    const scenario: Scenario = {
      plan: { tasks: [{ id: "t1", title: "prose task", kind: "implement", deps: [], acceptance_checks: [], acceptance_prose: "ship it" }] },
      verdicts: [{ task_complete: true, confidence: 0.9, blockers: [], next_action: { kind: "none", instruction: "" } }],
      turns: [{ mutate: [{ file: "x.txt", content: "1" }], delta: "did the prose task" }],
    };
    const result = await run(p.root, scenario);
    expect(result.status).toBe("done");
  });

  it("two-turn task: continue on the same session then complete", async () => {
    const p = project(["test -f final.txt"]);
    const scenario: Scenario = {
      plan: { tasks: [task("t1", ["test -f final.txt"])] },
      verdicts: [{ task_complete: false, confidence: 0.3, blockers: [], next_action: { kind: "continue", instruction: "now create final.txt" } }],
      turns: [
        { mutate: [{ file: "partial.txt", content: "1" }], delta: "partial", session: "sess-keep" },
        { mutate: [{ file: "final.txt", content: "1" }], delta: "final", session: "sess-keep" },
      ],
    };
    const result = await run(p.root, scenario, { global_turns: 6 });
    expect(result.status).toBe("done");
    // session captured and reused for the task
    expect(result.session_map["t1"]).toBe("sess-keep");
  });
});

describe("verdict robustness", () => {
  it("malformed verdict JSON falls back to objective-checks decision", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    const scenario: Scenario = { verdicts: [{ not: "a-valid-verdict" } as unknown as Record<string, unknown>] };
    const t = { ...task("t1", []), status: "in_progress" as const, attempts: 1, approach: "default", last_failure: null, evidence: { proof_ptrs: [], tree: null } };
    const vr = await withEnv(scenarioEnv(p.root, scenario, "v"), () =>
      getVerdict(t, emptyContext("t1"), [], "agent said done", [], p.root, true),
    );
    expect(vr.source).toBe("fallback");
  });
});

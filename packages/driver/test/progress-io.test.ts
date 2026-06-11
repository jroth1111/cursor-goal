import { afterEach, describe, expect, it } from "vitest";
import { runGoal } from "../src/driver/loop.js";
import { formatProgress, type ProgressEvent } from "../src/driver/progress-io.js";
import { mkGitProject, scenarioEnv, withEnv, type Project, type Scenario } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function project(goalChecks: string[]): Project {
  const goalMd = `# Goal\n\n## Goal\nProgress test\n\n## Checks\n\n${goalChecks.map((c) => `- \`${c}\``).join("\n")}\n`;
  const p = mkGitProject({ "GOAL.md": goalMd });
  cleanups.push(p.cleanup);
  return p;
}

describe("progress formatting", () => {
  it("renders each event kind on one line with key facts", () => {
    expect(formatProgress({ kind: "decomposed", tasks: 3, source: "planner" })).toBe("[plan] 3 task(s) via planner");
    expect(
      formatProgress({ kind: "turn_start", turn: 7, taskId: "t1", title: "add endpoint", attempt: 2, fresh: false }),
    ).toBe('[turn 7] t1 "add endpoint" (attempt 2, resume)');
    expect(
      formatProgress({
        kind: "turn_end",
        turn: 7,
        taskId: "t1",
        terminal: "success",
        tokens: 12345,
        elapsedMs: 84000,
        decision: "continue_same_session",
        reason: "fix the failing test",
      }),
    ).toBe("[turn 7] success in 84s · 12.3k tok → continue_same_session: fix the failing test");
    expect(formatProgress({ kind: "review", round: 1, material: 3, satisfied: false, residual: false })).toBe(
      "[review 1] 3 material finding(s) → remediation",
    );
    expect(formatProgress({ kind: "review", round: 2, material: 0, satisfied: true, residual: false })).toBe(
      "[review 2] satisfied — shipping",
    );
    expect(formatProgress({ kind: "review", round: 3, material: 2, satisfied: false, residual: true })).toBe(
      "[review 3] not converging — shipping with 2 residual finding(s)",
    );
    expect(formatProgress({ kind: "escalation", reason: "budget exhausted" })).toBe("[escalate] budget exhausted");
    expect(formatProgress({ kind: "done", turns: 9 })).toBe("[done] 9 turn(s)");
    // long reasons clip to one line
    const long = formatProgress({
      kind: "turn_end",
      turn: 1,
      taskId: "t",
      terminal: "success",
      tokens: 10,
      elapsedMs: 10,
      decision: "continue_same_session",
      reason: "x".repeat(300),
    });
    expect(long.length).toBeLessThan(200);
    expect(long).toMatch(/…$/);
  });
});

describe("progress events through the loop", () => {
  it("emits decomposed → turn pairs → done with accurate fields", async () => {
    const p = project(["test -f made.txt"]);
    const scenario: Scenario = {
      plan: {
        tasks: [
          { id: "t1", title: "make it", kind: "implement", deps: [], acceptance_checks: ["test -f made.txt"], acceptance_prose: "" },
        ],
      },
      verdicts: [{ task_complete: false, confidence: 0.3, blockers: [], next_action: { kind: "continue", instruction: "actually write the file" } }],
      turns: [
        { delta: "thinking" }, // checks fail -> continue
        { mutate: [{ file: "made.txt", content: "x" }] },
      ],
    };
    const events: ProgressEvent[] = [];
    const result = await withEnv(scenarioEnv(p.root, scenario, "pg1"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 6, review_rounds: 0 }, progress: (e) => events.push(e) }),
    );
    expect(result.status).toBe("done");

    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe("decomposed");
    expect(kinds).toEqual(["decomposed", "turn_start", "turn_end", "turn_start", "turn_end", "done"]);

    const starts = events.filter((e) => e.kind === "turn_start");
    expect(starts[0]).toMatchObject({ turn: 1, taskId: "t1", attempt: 1, fresh: true });
    expect(starts[1]).toMatchObject({ turn: 2, taskId: "t1", attempt: 2, fresh: false }); // session resumed

    const ends = events.filter((e) => e.kind === "turn_end");
    expect(ends[0]).toMatchObject({ turn: 1, terminal: "success", decision: "continue_same_session" });
    expect(ends[1]).toMatchObject({ turn: 2, terminal: "success", decision: "task_done" });
    expect(events[events.length - 1]).toMatchObject({ kind: "done", turns: 2 });
  });

  it("emits escalation when the attempt budget is exhausted", async () => {
    const p = project(["test -f never.txt"]);
    const scenario: Scenario = {
      plan: { tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: ["test -f never.txt"], acceptance_prose: "" }] },
      turns: [{ result: "error" }],
    };
    const events: ProgressEvent[] = [];
    const result = await withEnv(scenarioEnv(p.root, scenario, "pg2"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 4, task_attempts: 1, review_rounds: 0 }, progress: (e) => events.push(e) }),
    );
    expect(result.status).toBe("escalated");
    const esc = events.find((e) => e.kind === "escalation");
    expect(esc).toBeDefined();
    expect((esc as { reason: string }).reason).toMatch(/attempt budget exhausted/);
  });

  it("emits review events through the excellence gate", async () => {
    const p = project(["test -f made.txt"]);
    const scenario: Scenario = {
      plan: { tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: ["test -f made.txt"], acceptance_prose: "" }] },
      reviews: [
        { satisfied: false, findings: [{ severity: "high", area: "edge-cases", issue: "no empty-input handling", fix: "handle empty input" }] },
        { satisfied: true, findings: [] },
      ],
      turns: [
        { mutate: [{ file: "made.txt", content: "x" }] },
        { mutate: [{ file: "fixed.txt", content: "x" }] }, // remediation turn
      ],
      verdicts: [{ task_complete: true, confidence: 0.9, blockers: [], next_action: { kind: "none", instruction: "" } }],
    };
    const events: ProgressEvent[] = [];
    const result = await withEnv(scenarioEnv(p.root, scenario, "pg3"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 8, review_rounds: 3 }, progress: (e) => events.push(e) }),
    );
    expect(result.status).toBe("done");
    const reviews = events.filter((e) => e.kind === "review");
    expect(reviews[0]).toMatchObject({ round: 1, material: 1, satisfied: false });
    expect(reviews[1]).toMatchObject({ round: 2, satisfied: true });
  });

  it("no emitter -> silent (default)", async () => {
    const p = project(["test -f made.txt"]);
    const scenario: Scenario = {
      plan: { tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: ["test -f made.txt"], acceptance_prose: "" }] },
      turns: [{ mutate: [{ file: "made.txt", content: "x" }] }],
    };
    // simply runs clean without a progress sink — the default used by tests/hook bridge
    const result = await withEnv(scenarioEnv(p.root, scenario, "pg4"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 4, review_rounds: 0 } }),
    );
    expect(result.status).toBe("done");
  });
});

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
    expect(result.escalation_reason).toMatch(/global turn/);
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

  it("excellence gate: a material review finding spawns remediation, then ships when satisfied", async () => {
    const p = project(["test -f impl.txt"]);
    const scenario: Scenario = {
      plan: { tasks: [task("t1", ["test -f impl.txt"])] },
      reviews: [
        { satisfied: false, findings: [{ severity: "high", area: "tests", issue: "no tests", fix: "add a test", check: "test -f test_impl.txt" }] },
        { satisfied: true, findings: [] },
      ],
      turns: [
        { mutate: [{ file: "impl.txt", content: "x" }], delta: "impl" },
        { mutate: [{ file: "test_impl.txt", content: "t" }], delta: "added test" },
      ],
    };
    const result = await run(p.root, scenario, { review_rounds: 3, global_turns: 8 });
    expect(result.status).toBe("done");
    expect(result.review_rounds_done).toBe(2);
    expect(existsSync(path.join(p.root, "test_impl.txt"))).toBe(true);
    const journal = await readJournalTail(p.root, 80);
    expect(journal.some((e) => /review round 1: 1 material finding/.test(e.note ?? ""))).toBe(true);
    expect(journal.some((e) => /review round 2: satisfied/.test(e.note ?? ""))).toBe(true);
  });

  it("review convergence: stops and ships with residual when findings stop decreasing", async () => {
    const p = project(["test -f impl.txt"]);
    // every round reports the same single material finding; remediation "completes"
    // (check `true`) but the reviewer keeps finding it — i.e. no real convergence.
    const stuck = { satisfied: false, findings: [{ severity: "high", area: "x", issue: "persistent", fix: "f", check: "true" }] };
    const scenario: Scenario = {
      plan: { tasks: [task("t1", ["test -f impl.txt"])] },
      reviews: [stuck, stuck, stuck, stuck],
      turns: [{ mutate: [{ file: "impl.txt", content: "x" }] }, { mutate: [{ file: "noop.txt", content: "y" }] }],
    };
    const result = await run(p.root, scenario, { review_rounds: 12, global_turns: 20 });
    expect(result.status).toBe("done"); // ships rather than looping all 12 rounds
    expect(result.review_rounds_done).toBeLessThan(12);
    expect(result.residual_findings.length).toBe(1);
    const journal = await readJournalTail(p.root, 80);
    expect(journal.some((e) => /not converging/.test(e.note ?? ""))).toBe(true);
  });

  it("unlimited (null) token/wall budgets do not trip the circuit breaker", async () => {
    const p = project(["test -f made.txt"]);
    const scenario: Scenario = {
      plan: { tasks: [task("t1", ["test -f made.txt"])] },
      turns: [{ mutate: [{ file: "made.txt", content: "hi" }] }],
    };
    // defaults already set token_budget/wall_ms to null; assert a clean finish.
    const result = await run(p.root, scenario);
    expect(result.status).toBe("done");
    expect(result.budgets.token_budget).toBeNull();
    expect(result.budgets.wall_ms).toBeNull();
  });

  it("--fast (review_rounds 0) ships on acceptance without a review", async () => {
    const p = project(["test -f impl.txt"]);
    const scenario: Scenario = {
      plan: { tasks: [task("t1", ["test -f impl.txt"])] },
      reviews: [{ satisfied: false, findings: [{ severity: "critical", area: "x", issue: "i", fix: "f" }] }],
      turns: [{ mutate: [{ file: "impl.txt", content: "x" }] }],
    };
    const result = await run(p.root, scenario, { review_rounds: 0, global_turns: 6 });
    expect(result.status).toBe("done");
    expect(result.review_rounds_done).toBe(0); // review never ran
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

  it("reward-hack: passing the check by deleting a test is caught, never marked done", async () => {
    const p = project(["test -f impl.txt"], { "tests/foo.test.ts": "it('x', () => {});\n" });
    const scenario: Scenario = {
      plan: { tasks: [task("t1", ["test -f impl.txt"])] },
      verdicts: [{ task_complete: true, confidence: 0.9, blockers: [], next_action: { kind: "none", instruction: "" } }],
      turns: [{ mutate: [{ file: "impl.txt", content: "x" }, { rm: "tests/foo.test.ts" }], delta: "done (and deleted the test)" }],
    };
    const result = await run(p.root, scenario, { task_attempts: 2, global_turns: 6 });
    // the acceptance check passes, but the integrity guard refuses to accept it
    expect(existsSync(path.join(p.root, "impl.txt"))).toBe(true);
    expect(result.status).toBe("escalated");
    expect(result.escalation_reason).toMatch(/integrity/);
    const journal = await readJournalTail(p.root, 60);
    expect(journal.some((e) => /integrity blocked completion/.test(e.note ?? ""))).toBe(true);
  });

  it("scope creep: editing outside declared scope blocks completion", async () => {
    const goalMd = "# Goal\n\n## Goal\nScoped change\n\n## Scope\n\n- `src/`\n\n## Checks\n\n- `test -f src/done.txt`\n";
    const p = mkGitProject({ "GOAL.md": goalMd });
    cleanups.push(p.cleanup);
    const scenario: Scenario = {
      plan: { tasks: [task("t1", ["test -f src/done.txt"])] },
      verdicts: [{ task_complete: false, confidence: 0.3, blockers: [], next_action: { kind: "continue", instruction: "stay in scope" } }],
      turns: [{ mutate: [{ file: "src/done.txt", content: "ok" }, { file: "elsewhere/leak.txt", content: "out of scope" }] }],
    };
    const result = await withEnv(scenarioEnv(p.root, scenario, "sc"), () =>
      runGoal({ root: p.root, budgets: { task_attempts: 2, global_turns: 6 } }),
    );
    expect(result.status).toBe("escalated");
    expect(result.escalation_reason).toMatch(/integrity|out-of-scope/);
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
    const t = { ...task("t1", []), scope: [], status: "in_progress" as const, attempts: 1, approach: "default", last_failure: null, last_failure_artifact: null, evidence: { proof_ptrs: [], tree: null } };
    const vr = await withEnv(scenarioEnv(p.root, scenario, "v"), () =>
      getVerdict(t, emptyContext("t1"), [], "agent said done", [], p.root, true, 0),
    );
    expect(vr.source).toBe("fallback");
  });
});

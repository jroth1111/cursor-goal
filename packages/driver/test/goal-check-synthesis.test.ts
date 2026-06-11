import { afterEach, describe, expect, it } from "vitest";
import { decompose } from "../src/driver/decompose.js";
import { runGoal } from "../src/driver/loop.js";
import { readJournalTail } from "../src/lib/journal.js";
import { loadRun } from "../src/state/store.js";
import { validateTaskGraph } from "../src/state/schema.js";
import type { ProgressEvent } from "../src/driver/progress-io.js";
import { mkGitProject, scenarioEnv, withEnv, type Project, type Scenario } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function freeformProject(): Project {
  const p = mkGitProject(); // no GOAL.md — the freeform-prompt path
  cleanups.push(p.cleanup);
  return p;
}

const task = (id: string, checks: string[]) => ({
  id,
  title: id,
  kind: "implement" as const,
  deps: [],
  acceptance_checks: checks,
  acceptance_prose: "",
});

describe("goal-check synthesis: decompose", () => {
  it("schema accepts goal_checks; decompose dedupes against task checks and coerces strings", async () => {
    expect(validateTaskGraph({ goal_checks: ["npm test"], tasks: [task("a", ["true"])] })).toBe(true);
    const p = freeformProject();
    const plan = {
      goal_checks: ["test -f final.txt", "true", "", 42, "test -f final.txt"],
      tasks: [task("t1", ["true"])],
    };
    const dec = await withEnv(scenarioEnv(p.root, { plan }, "gs1"), () =>
      decompose({ goal_text: "g", source: "prompt", acceptance_checks: [], non_goals: [], scope: [] }, p.root),
    );
    expect(dec.source).toBe("planner");
    // deduped ("true" collides with a task check), de-blanked, strings only
    expect(dec.goalChecks).toEqual(["test -f final.txt"]);
  });
});

describe("goal-check synthesis: the loop", () => {
  it("freeform run adopts proposed checks, journals + emits PROPOSED, and is gated by them", async () => {
    const p = freeformProject();
    const scenario: Scenario = {
      plan: {
        goal_checks: ["test -f final.txt"],
        tasks: [task("t1", ["test -f step.txt"])],
      },
      verdicts: [{ task_complete: false, confidence: 0.3, blockers: [], next_action: { kind: "continue", instruction: "make final.txt too" } }],
      turns: [
        { mutate: [{ file: "step.txt", content: "x" }] }, // t1 done, but the goal gate fails
        { mutate: [{ file: "final.txt", content: "x" }] }, // remediation satisfies the adopted check
      ],
    };
    const events: ProgressEvent[] = [];
    const result = await withEnv(scenarioEnv(p.root, scenario, "gs2"), () =>
      runGoal({ root: p.root, goalInput: "make step and final", budgets: { global_turns: 8, review_rounds: 0 }, progress: (e) => events.push(e) }),
    );
    expect(result.status).toBe("done");
    expect(result.goal_spec.acceptance_checks).toEqual(["test -f final.txt"]);
    expect(result.proposed_goal_checks).toEqual(["test -f final.txt"]);

    const journal = await readJournalTail(p.root, 60);
    expect(journal.some((e) => /goal checks proposed by planner \(adopted/.test(e.note ?? ""))).toBe(true);
    // the gate actually used the adopted check: a remediation task was spawned for it
    expect(journal.some((e) => /goal checks failing \(test -f final\.txt\)/.test(e.note ?? ""))).toBe(true);

    const proposed = events.find((e) => e.kind === "goal_checks");
    expect(proposed).toBeDefined();
    expect((proposed as { checks: string[] }).checks).toEqual(["test -f final.txt"]);
  });

  it("human GOAL.md checks are never overridden by planner proposals", async () => {
    const goalMd = "# Goal\n\n## Goal\nHuman gated\n\n## Checks\n\n- `test -f human.txt`\n";
    const p = mkGitProject({ "GOAL.md": goalMd });
    cleanups.push(p.cleanup);
    const scenario: Scenario = {
      plan: {
        goal_checks: ["test -f planner.txt"], // must be ignored
        tasks: [task("t1", ["test -f human.txt"])],
      },
      turns: [{ mutate: [{ file: "human.txt", content: "x" }] }],
    };
    const result = await withEnv(scenarioEnv(p.root, scenario, "gs3"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 4, review_rounds: 0 } }),
    );
    expect(result.status).toBe("done");
    expect(result.goal_spec.acceptance_checks).toEqual(["test -f human.txt"]);
    expect(result.proposed_goal_checks).toEqual([]);
  });

  it("an unrunnable proposed check is dropped loudly at the gate instead of remediated forever", async () => {
    const p = freeformProject();
    const scenario: Scenario = {
      plan: {
        // "test -s out.txt" is distinct from the task check, so it survives dedup
        // and proves the gate still enforces the REMAINING proposed checks after a drop
        goal_checks: ["definitely-not-a-command-xyz --verify", "test -s out.txt"],
        tasks: [task("t1", ["test -f out.txt"])],
      },
      turns: [{ mutate: [{ file: "out.txt", content: "x" }] }],
    };
    const result = await withEnv(scenarioEnv(p.root, scenario, "gs4"), () =>
      runGoal({ root: p.root, goalInput: "make out", budgets: { global_turns: 6, review_rounds: 0 } }),
    );
    expect(result.status).toBe("done"); // not deadlocked by the hallucinated check
    expect(result.goal_spec.acceptance_checks).toEqual(["test -s out.txt"]);

    const journal = await readJournalTail(p.root, 60);
    const drop = journal.find((e) => /DROPPED unrunnable planner-proposed goal check/.test(e.note ?? ""));
    expect(drop).toBeDefined();
    expect(drop!.note).toMatch(/definitely-not-a-command-xyz/);
    // the surviving check actually gated the run
    expect(journal.some((e) => /goal acceptance checks pass/.test(e.note ?? ""))).toBe(true);

    const onDisk = (await loadRun(p.root))!;
    expect(onDisk.proposed_goal_checks).toEqual(["test -s out.txt"]);
  });

  it("a RUNNABLE proposed check that fails with 'No such file or directory' is remediated, never dropped", async () => {
    const p = freeformProject();
    const scenario: Scenario = {
      plan: {
        // `cat` exists (exit 1 when the file is missing) — only exit 127 may drop
        goal_checks: ["cat deliverable.txt"],
        tasks: [task("t1", ["test -f out.txt"])],
      },
      verdicts: [{ task_complete: false, confidence: 0.3, blockers: [], next_action: { kind: "continue", instruction: "write the deliverable" } }],
      turns: [
        { mutate: [{ file: "out.txt", content: "x" }] }, // t1 done; gate fails on cat
        { mutate: [{ file: "deliverable.txt", content: "the goods" }] }, // remediation satisfies it
      ],
    };
    const result = await withEnv(scenarioEnv(p.root, scenario, "gs5"), () =>
      runGoal({ root: p.root, goalInput: "produce the deliverable", budgets: { global_turns: 8, review_rounds: 0 } }),
    );
    expect(result.status).toBe("done");
    // the check survived as the contract and was satisfied via remediation
    expect(result.goal_spec.acceptance_checks).toEqual(["cat deliverable.txt"]);
    const journal = await readJournalTail(p.root, 60);
    expect(journal.some((e) => /DROPPED unrunnable/.test(e.note ?? ""))).toBe(false);
    expect(journal.some((e) => /goal checks failing \(cat deliverable\.txt\)/.test(e.note ?? ""))).toBe(true);
  });
});

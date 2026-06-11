import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { runGoal } from "../src/driver/loop.js";
import { replanTask } from "../src/driver/replan.js";
import { checkIntegrity } from "../src/driver/integrity.js";
import { readJournalTail } from "../src/lib/journal.js";
import {
  validateGraphSemantics,
  validateTaskGraph,
  type Task,
  type TaskGraph,
} from "../src/state/schema.js";
import { materializeGraph } from "../src/state/store.js";
import { mkGitProject, scenarioEnv, withEnv, type Project, type Scenario } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function draft(id: string, scope?: string[]) {
  return {
    id,
    title: id,
    kind: "implement" as const,
    deps: [] as string[],
    acceptance_checks: ["true"],
    acceptance_prose: "",
    ...(scope ? { scope } : {}),
  };
}

function fullTask(id: string, scope: string[] = []): Task {
  return {
    ...draft(id),
    scope,
    status: "pending",
    attempts: 0,
    approach: "default",
    last_failure: null,
    last_failure_artifact: null,
    evidence: { proof_ptrs: [], tree: null },
  };
}

describe("per-task scope: schema", () => {
  it("ajv accepts a task with a scope array and coercion defaults it when omitted", () => {
    expect(validateTaskGraph({ tasks: [draft("a", ["src"])] })).toBe(true);
    expect(validateTaskGraph({ tasks: [draft("a")] })).toBe(true);
    const g = materializeGraph({ tasks: [draft("a")] });
    expect(g.tasks[0].scope).toEqual([]);
    const g2 = materializeGraph({ tasks: [draft("a", ["src/x"])] });
    expect(g2.tasks[0].scope).toEqual(["src/x"]);
  });

  it("task scope may only narrow a non-empty goal scope", () => {
    const inside: TaskGraph = { tasks: [fullTask("a", ["src/feature"])] };
    expect(validateGraphSemantics(inside, ["src", "docs"])).toBeNull();
    const outside: TaskGraph = { tasks: [fullTask("a", ["lib"])] };
    expect(validateGraphSemantics(outside, ["src", "docs"])).toMatch(/falls outside the goal scope/);
    // empty goal scope = no outer bound
    expect(validateGraphSemantics(outside, [])).toBeNull();
    // normalization: trailing slashes and ./ prefixes don't defeat the check
    const messy: TaskGraph = { tasks: [fullTask("a", ["./src/"])] };
    expect(validateGraphSemantics(messy, ["src"])).toBeNull();
  });
});

describe("per-task scope: integrity fence", () => {
  it("uses the task fence when present and names it; falls back to goal scope", () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    // in goal scope (src+docs) but outside the task fence (src)
    const issues = checkIntegrity(p.root, ["docs/extra.md"], ["src", "docs"], ["src"]);
    expect(issues.some((i) => /outside this task's scope \(src\)/.test(i) && /docs\/extra\.md/.test(i))).toBe(true);
    // same file with no task fence: goal scope allows it
    expect(checkIntegrity(p.root, ["docs/extra.md"], ["src", "docs"])).toEqual([]);
    // empty task scope inherits goal behavior exactly
    expect(checkIntegrity(p.root, ["elsewhere/f.txt"], ["src"], [])).toEqual([
      "edited out-of-scope file: elsewhere/f.txt",
    ]);
  });
});

describe("per-task scope: replan inheritance", () => {
  const asTurn = (payload: unknown) =>
    Promise.resolve({
      sessionId: "plan-sess",
      finalText: JSON.stringify(payload),
      usage: null,
      terminal: "success" as const,
      exitCode: 0,
      timedOut: false,
    });

  it("subtasks keep a narrowing proposal, inherit when absent, and fall back when escaping", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    const parent = fullTask("p1", ["src"]);
    const graph: TaskGraph = { tasks: [parent] };
    const spec = { goal_text: "g", source: "prompt" as const, acceptance_checks: [], non_goals: [], scope: ["src", "docs"] };
    const sub = {
      tasks: [
        { ...draft("narrow", ["src/sub"]) },
        { ...draft("inherit") },
        { ...draft("escape", ["docs"]) }, // outside the parent fence
      ],
    };
    const out = await replanTask(graph, parent, "stuck", spec, p.root, () => asTurn(sub));
    expect(out.graph).not.toBeNull();
    const byId = new Map(out.graph!.tasks.map((t) => [t.id, t]));
    expect(byId.get("p1.narrow")!.scope).toEqual(["src/sub"]);
    expect(byId.get("p1.inherit")!.scope).toEqual(["src"]);
    expect(byId.get("p1.escape")!.scope).toEqual(["src"]); // dropped, inherited
  });
});

describe("per-task scope: loop feedback", () => {
  it("an in-goal-scope but out-of-task-scope edit blocks completion, is fed back, then resolves", async () => {
    const goalMd = [
      "# Goal",
      "",
      "## Goal",
      "Scoped goal",
      "",
      "## Scope",
      "",
      "- `src`",
      "- `docs`",
      "",
      "## Checks",
      "",
      "- `test -f src/made.txt`",
      "",
    ].join("\n");
    const p: Project = mkGitProject({ "GOAL.md": goalMd });
    cleanups.push(p.cleanup);
    mkdirSync(path.join(p.root, "src"), { recursive: true });
    mkdirSync(path.join(p.root, "docs"), { recursive: true });

    const scenario: Scenario = {
      plan: {
        tasks: [
          {
            id: "t1",
            title: "make the file",
            kind: "implement",
            deps: [],
            acceptance_checks: ["test -f src/made.txt"],
            acceptance_prose: "",
            scope: ["src"],
          },
        ],
      },
      turns: [
        // checks pass but docs/stray.txt is outside the task fence (still inside goal scope)
        {
          mutate: [
            { file: "src/made.txt", content: "x" },
            { file: "docs/stray.txt", content: "stray" },
          ],
        },
        // undo the violation, keep the real work
        { mutate: [{ rm: "docs/stray.txt" }] },
      ],
    };

    const result = await withEnv(scenarioEnv(p.root, scenario), () =>
      runGoal({ root: p.root, budgets: { global_turns: 6, review_rounds: 0 } }),
    );
    expect(result.status).toBe("done");
    expect(existsSync(path.join(p.root, "docs", "stray.txt"))).toBe(false);

    const journal = await readJournalTail(p.root, 50);
    const blocked = journal.find((e) => /integrity blocked completion/.test(e.note ?? ""));
    expect(blocked).toBeDefined();
    expect(blocked!.note).toMatch(/outside this task's scope \(src\)/);
    expect(blocked!.note).toMatch(/docs\/stray\.txt/);
  });
});

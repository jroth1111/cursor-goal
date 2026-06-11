import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildInstruction } from "../src/driver/instruct.js";
import { emptyContext, loadContext } from "../src/driver/context-window.js";
import { steerTask } from "../src/driver/steer.js";
import { runGoal } from "../src/driver/loop.js";
import { readJournalTail } from "../src/lib/journal.js";
import { contextPath, driverDir } from "../src/lib/paths.js";
import { saveGraph, materializeGraph } from "../src/state/store.js";
import { writeJson } from "../src/lib/paths.js";
import type { GoalSpec, Task } from "../src/state/schema.js";
import type { TurnResult } from "../src/agent/runner.js";
import { mkGitProject, type Project } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

const spec: GoalSpec = { goal_text: "g", source: "prompt", acceptance_checks: [], non_goals: [], scope: [] };

function fullTask(id: string): Task {
  return {
    id,
    title: id,
    kind: "implement",
    deps: [],
    acceptance_checks: ["true"],
    acceptance_prose: "",
    scope: [],
    status: "pending",
    attempts: 0,
    approach: "default",
    last_failure: null,
    last_failure_artifact: null,
    evidence: { proof_ptrs: [], tree: null },
  };
}

describe("operator guidance rendering", () => {
  it("renders above model steering and below acceptance; accumulates with a count", () => {
    const ctx = emptyContext("t1");
    ctx.operator_guidance.push({ at: "2026-06-10T00:00:00Z", text: "older note" });
    ctx.operator_guidance.push({ at: "2026-06-10T00:01:00Z", text: "use the conftest fixture" });
    ctx.next_step = "model says do X";
    ctx.attempts.push({ turn: 1, instruction_summary: "s", terminal: "success", check_fails: [], diff_stat: "changed" });
    const out = buildInstruction(spec, fullTask("t1"), ctx, ctx.next_step, false);

    const guidanceAt = out.indexOf("OPERATOR GUIDANCE");
    expect(guidanceAt).toBeGreaterThan(-1);
    expect(out).toContain("use the conftest fixture");
    expect(out).not.toContain("older note"); // latest renders; earlier ones counted
    expect(out).toContain("+1 earlier note(s)");
    expect(guidanceAt).toBeGreaterThan(out.indexOf("commands exit 0")); // below acceptance
    expect(guidanceAt).toBeLessThan(out.indexOf("What has already been tried")); // above history
    expect(guidanceAt).toBeLessThan(out.indexOf("Next step: model says do X")); // above model steering
  });

  it("absent guidance renders nothing", () => {
    const out = buildInstruction(spec, fullTask("t1"), emptyContext("t1"), null, true);
    expect(out).not.toContain("OPERATOR GUIDANCE");
  });

  it("context files written before steer existed load with an empty list", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    const legacy = { ...emptyContext("t1") } as Record<string, unknown>;
    delete legacy.operator_guidance;
    await writeJson(contextPath(p.root, "t1"), legacy);
    const ctx = await loadContext(p.root, "t1");
    expect(ctx.operator_guidance).toEqual([]);
  });
});

describe("steerTask", () => {
  async function seedGraph(p: Project, status: Task["status"] = "pending"): Promise<void> {
    const graph = materializeGraph({
      tasks: [{ id: "t1", title: "x", kind: "implement", deps: [], acceptance_checks: ["true"], acceptance_prose: "" }],
    });
    graph.tasks[0].status = status;
    await saveGraph(p.root, graph);
  }

  it("records guidance, journals it, and survives reloads", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    await seedGraph(p);
    const r1 = await steerTask(p.root, "t1", "try the smaller refactor first");
    expect(r1.ok).toBe(true);
    const r2 = await steerTask(p.root, "t1", "and keep the public API frozen");
    expect(r2.ok).toBe(true);
    expect(r2.message).toMatch(/note 2/);
    const ctx = await loadContext(p.root, "t1");
    expect(ctx.operator_guidance.map((g) => g.text)).toEqual([
      "try the smaller refactor first",
      "and keep the public API frozen",
    ]);
    const journal = await readJournalTail(p.root, 10);
    expect(journal.filter((e) => /operator steer/.test(e.note ?? ""))).toHaveLength(2);
  });

  it("error paths: no run, unknown task, done task, empty text, live lock", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    expect((await steerTask(p.root, "t1", "hi")).message).toMatch(/No driver run/);

    await seedGraph(p);
    const unknown = await steerTask(p.root, "nope", "hi");
    expect(unknown.ok).toBe(false);
    expect(unknown.message).toMatch(/No such task 'nope'/);
    expect(unknown.message).toMatch(/t1/); // lists open tasks

    expect((await steerTask(p.root, "t1", "   ")).message).toMatch(/Empty guidance/);

    await seedGraph(p, "done");
    expect((await steerTask(p.root, "t1", "hi")).message).toMatch(/already done/);

    await seedGraph(p);
    const lockDir = path.join(driverDir(p.root), ".lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      path.join(lockDir, "owner.json"),
      JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }),
    );
    const locked = await steerTask(p.root, "t1", "hi");
    expect(locked.ok).toBe(false);
    expect(locked.message).toMatch(/mid-run and holds the lock/);
  });
});

describe("steering reaches the prompt and survives switch_approach", () => {
  it("pre-run guidance appears in turn 1 and persists into the fresh session after a failure", async () => {
    const goalMd = "# Goal\n\n## Goal\nSteered goal\n\n## Checks\n\n- `test -f out.txt`\n";
    const p = mkGitProject({ "GOAL.md": goalMd });
    cleanups.push(p.cleanup);

    // seed the graph + guidance before the run (steer works on a not-yet-resumed run)
    const graph = materializeGraph({
      tasks: [{ id: "t1", title: "make out.txt", kind: "implement", deps: [], acceptance_checks: ["test -f out.txt"], acceptance_prose: "" }],
    });
    await saveGraph(p.root, graph);
    const steered = await steerTask(p.root, "t1", "the fixture lives in tests/conftest.py");
    expect(steered.ok).toBe(true);

    const instructions: string[] = [];
    let turn = 0;
    const call = async (opts: { instruction: string; mode?: string }): Promise<TurnResult> => {
      if (opts.mode === "ask") {
        return { sessionId: "ask", finalText: "{}", usage: null, terminal: "success", exitCode: 0, timedOut: false };
      }
      instructions.push(opts.instruction);
      turn += 1;
      if (turn === 1) {
        // abnormal end -> onAgentFailure -> switch_approach (fresh session)
        return { sessionId: "s1", finalText: "boom", usage: null, terminal: "error", exitCode: 1, timedOut: false };
      }
      writeFileSync(path.join(p.root, "out.txt"), "done");
      return { sessionId: "s2", finalText: "done", usage: null, terminal: "success", exitCode: 0, timedOut: false };
    };

    const result = await runGoal({ root: p.root, budgets: { global_turns: 6, review_rounds: 0 }, call });
    expect(result.status).toBe("done");
    expect(instructions.length).toBeGreaterThanOrEqual(2);
    // guidance led the first instruction AND the post-switch fresh-session one
    expect(instructions[0]).toContain("OPERATOR GUIDANCE");
    expect(instructions[0]).toContain("the fixture lives in tests/conftest.py");
    expect(instructions[1]).toContain("OPERATOR GUIDANCE");
    expect(instructions[1]).toContain("the fixture lives in tests/conftest.py");
  });
});

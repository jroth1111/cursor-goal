import { describe, expect, it } from "vitest";
import { extractJsonObject } from "../src/lib/json-extract.js";
import {
  formatChangedFilesForPrompt,
  formatFailureForPrompt,
  progressiveReveal,
  revealForPrompt,
  withArtifactRef,
} from "../src/lib/progressive-reveal.js";
import { buildInstruction } from "../src/driver/instruct.js";
import { verdictPrompt } from "../src/driver/verdict.js";
import {
  formatToolRunsForVerdict,
  mergeProofPtrs,
  readToolRunsSince,
  type ToolRunRow,
} from "../src/lib/tool-runs.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { matchDestructiveRule, shellPolicyDenyFixtures } from "../src/lib/shell-allow.js";
import {
  validateGraphSemantics,
  validateTaskGraph,
  validateVerdict,
  type TaskGraph,
} from "../src/state/schema.js";
import { isOscillating, pushFingerprint } from "../src/driver/progress.js";
import { initRun } from "../src/state/store.js";

describe("extractJsonObject", () => {
  it("pulls a bare object out of prose", () => {
    expect(extractJsonObject('here you go: {"a":1} done')).toEqual({ a: 1 });
  });
  it("pulls from a fenced block", () => {
    expect(extractJsonObject('```json\n{"b":2}\n```')).toEqual({ b: 2 });
  });
  it("handles braces inside strings", () => {
    expect(extractJsonObject('{"s":"a}b{c"}')).toEqual({ s: "a}b{c" });
  });
  it("returns null when there is no object", () => {
    expect(extractJsonObject("no json here")).toBeNull();
  });
});

describe("shell policy", () => {
  it("denies every deny_fixture", () => {
    for (const cmd of shellPolicyDenyFixtures()) {
      expect(matchDestructiveRule(cmd), cmd).not.toBeNull();
    }
  });
  it("allows benign commands", () => {
    for (const cmd of ["npm test", "ls -la", "git status", "rm file.txt", "echo hi"]) {
      expect(matchDestructiveRule(cmd), cmd).toBeNull();
    }
  });
});

describe("progressive reveal", () => {
  it("passes through short text unchanged", () => {
    expect(progressiveReveal("ok", { maxChars: 10 })).toEqual({
      preview: "ok",
      truncated: false,
      byteCount: 2,
    });
  });

  it("tails long text and adds an artifact pointer for prompts", () => {
    const long = "x".repeat(100);
    const out = revealForPrompt(long, { maxChars: 20, tail: true }, ".cursor/goal/driver/evidence/foo.txt");
    expect(out).toContain("x".repeat(20));
    expect(out).toContain("full output: .cursor/goal/driver/evidence/foo.txt");
    expect(withArtifactRef("tail", "path", true, 999)).toMatch(/999 bytes total/);
  });

  it("lists small file sets entirely and truncates huge diffs", () => {
    expect(formatChangedFilesForPrompt(["a.ts", "b.ts"])).toBe("a.ts, b.ts");
    const many = Array.from({ length: 80 }, (_, i) => `f${i}.ts`);
    expect(formatChangedFilesForPrompt(many)).toMatch(/git diff --name-only/);
  });

  it("keeps acceptance entire in instructions while failure detail is progressive", () => {
    const fullFail = "E".repeat(5000);
    const spec = { goal_text: "g", source: "prompt" as const, acceptance_checks: ["npm test"], non_goals: [], scope: [] };
    const task = {
      id: "t1",
      title: "do thing",
      kind: "implement" as const,
      deps: [],
      acceptance_checks: ["npm test"],
      acceptance_prose: "",
      status: "ready" as const,
      attempts: 1,
      approach: "default",
      last_failure: fullFail,
      last_failure_artifact: ".cursor/goal/driver/evidence/turn-failures/t1-turn1.txt",
      evidence: { proof_ptrs: [], tree: null },
    };
    const instruction = buildInstruction(spec, task, {
      task_id: "t1",
      attempts: [],
      tried_approaches: [],
      open_blockers: [],
      last_failure: fullFail,
      last_failure_artifact: task.last_failure_artifact!,
      next_step: "fix the test failure exactly",
    }, "fix the test failure exactly", false);
    expect(instruction).toContain("`npm test`");
    expect(instruction).toContain("fix the test failure exactly");
    expect(instruction).toContain("full output: .cursor/goal/driver/evidence/turn-failures/t1-turn1.txt");
    expect(instruction).not.toContain(fullFail);
  });
});

describe("tool-runs evidence", () => {
  it("reads rows since a turn start timestamp", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tool-runs-"));
    const evidence = path.join(root, ".cursor/goal/driver/evidence");
    await mkdir(evidence, { recursive: true });
    const file = path.join(evidence, "tool-runs.jsonl");
    const rows = [
      { at: "2026-01-01T00:00:00.000Z", tool_name: "old", output_tail: "x" },
      { at: "2026-06-10T12:00:00.000Z", tool_name: "new", output_tail: "y", output_artifact: ".cursor/goal/driver/evidence/tool-outputs/u1.txt" },
    ];
    await writeFile(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const since = Date.parse("2026-06-10T11:59:00.000Z");
    const got = await readToolRunsSince(root, since);
    expect(got).toHaveLength(1);
    expect(got[0]?.tool_name).toBe("new");
    rmSync(root, { recursive: true, force: true });
  });

  it("formats hook tool runs with artifact pointers for verdict", () => {
    const rows: ToolRunRow[] = [
      {
        at: "2026-06-10T12:00:00.000Z",
        tool_name: "shell",
        tool_use_id: "u1",
        duration: 9,
        output_tail: "tail",
        output_artifact: ".cursor/goal/driver/evidence/tool-outputs/u1.txt",
        truncated: true,
        output_bytes: 9000,
      },
    ];
    const block = formatToolRunsForVerdict(rows);
    expect(block).toContain("shell (u1)");
    expect(block).toContain("tool-outputs/u1.txt");
    expect(mergeProofPtrs([], rows)).toEqual([".cursor/goal/driver/evidence/tool-outputs/u1.txt"]);
  });

  it("includes tool runs in the verdict prompt", () => {
    const task = {
      id: "t1",
      title: "x",
      kind: "implement" as const,
      deps: [],
      acceptance_checks: ["true"],
      acceptance_prose: "",
      status: "in_progress" as const,
      attempts: 1,
      approach: "default",
      last_failure: null,
      last_failure_artifact: null,
      evidence: { proof_ptrs: [], tree: null },
    };
    const prompt = verdictPrompt(task, emptyContext("t1"), [], "summary", [], [
      { at: "2026-06-10T12:00:00.000Z", tool_name: "shell", output_tail: "ok" },
    ]);
    expect(prompt).toContain("Tool runs this turn");
    expect(prompt).toContain("shell");
  });
});

function emptyContext(taskId: string) {
  return {
    task_id: taskId,
    attempts: [],
    tried_approaches: [],
    open_blockers: [],
    last_failure: "",
    last_failure_artifact: "",
    next_step: "",
  };
}

describe("schema validation", () => {
  it("accepts a valid task graph", () => {
    const g = { tasks: [{ id: "t1", title: "x", kind: "implement", deps: [], acceptance_checks: ["true"], acceptance_prose: "" }] };
    expect(validateTaskGraph(g)).toBe(true);
    expect(validateGraphSemantics(g as unknown as TaskGraph)).toBeNull();
  });
  it("rejects a cyclic graph", () => {
    const g = {
      tasks: [
        { id: "a", title: "a", kind: "implement", deps: ["b"], acceptance_checks: ["true"], acceptance_prose: "" },
        { id: "b", title: "b", kind: "implement", deps: ["a"], acceptance_checks: ["true"], acceptance_prose: "" },
      ],
    };
    expect(validateGraphSemantics(g as unknown as TaskGraph)).toMatch(/cycle/);
  });
  it("rejects unknown deps", () => {
    const g = { tasks: [{ id: "a", title: "a", kind: "implement", deps: ["missing"], acceptance_checks: ["true"], acceptance_prose: "" }] };
    expect(validateGraphSemantics(g as unknown as TaskGraph)).toMatch(/unknown/);
  });
  it("accepts a large task graph with long fields (no arbitrary caps)", () => {
    const tasks = Array.from({ length: 50 }, (_, i) => ({
      id: `t${i}`,
      title: "x".repeat(300),
      kind: "implement" as const,
      deps: i > 0 ? [`t${i - 1}`] : [],
      acceptance_checks: Array.from({ length: 20 }, (_, j) => `echo check-${i}-${j}`),
      acceptance_prose: "p".repeat(2000),
    }));
    const g = { tasks };
    expect(validateTaskGraph(g)).toBe(true);
    expect(validateGraphSemantics(g as unknown as TaskGraph)).toBeNull();
  });

  it("accepts a planner task that omits acceptance_prose (real-world shape)", () => {
    // The live plan-mode agent returns acceptance_checks but no acceptance_prose;
    // requiring it forced the single-task fallback and lost the decomposition.
    const g = {
      tasks: [
        { id: "t1", title: "build", kind: "implement", deps: [], acceptance_checks: ["test -f x"] },
        { id: "t2", title: "verify", kind: "verify", deps: ["t1"], acceptance_checks: [] },
      ],
    };
    expect(validateTaskGraph(g)).toBe(true);
    expect(validateGraphSemantics(g as unknown as TaskGraph)).toBeNull();
  });

  it("validates a verdict", () => {
    expect(
      validateVerdict({ task_complete: true, confidence: 0.9, blockers: [], next_action: { kind: "none", instruction: "" } }),
    ).toBe(true);
    expect(validateVerdict({ task_complete: "yes" })).toBe(false);
  });
});

describe("oscillation detection", () => {
  it("flags A -> B -> A", () => {
    const run = initRun({ goal_text: "g", source: "prompt", acceptance_checks: [], non_goals: [], scope: [] });
    pushFingerprint(run, "A");
    pushFingerprint(run, "B");
    expect(isOscillating(run, "A")).toBe(true);
  });
  it("does not flag steady progress", () => {
    const run = initRun({ goal_text: "g", source: "prompt", acceptance_checks: [], non_goals: [], scope: [] });
    pushFingerprint(run, "A");
    pushFingerprint(run, "B");
    expect(isOscillating(run, "C")).toBe(false);
  });
});

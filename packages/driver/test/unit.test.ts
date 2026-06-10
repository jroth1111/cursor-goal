import { describe, expect, it } from "vitest";
import { extractJsonObject } from "../src/lib/json-extract.js";
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

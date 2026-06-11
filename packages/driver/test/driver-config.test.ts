import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { intake, parseDriverSection } from "../src/driver/intake.js";
import { initRun } from "../src/state/store.js";
import { runGoal } from "../src/driver/loop.js";
import type { TurnResult } from "../src/agent/runner.js";
import { mkGitProject } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

const TEMPLATE = fileURLToPath(
  new URL("../../../core/.cursor/goal/templates/GOAL.md", import.meta.url),
);

function goalMd(driverLines: string[]): string {
  return [
    "# Goal",
    "",
    "## Goal",
    "Configured goal",
    "",
    "## Checks",
    "",
    "- `true`",
    "",
    "## Driver",
    "",
    ...driverLines,
    "",
  ].join("\n");
}

describe("## Driver section parsing", () => {
  it("parses the full key set", () => {
    const { defaults, warnings } = parseDriverSection(
      goalMd([
        "- model: sonnet-4",
        "- max_turns: 60",
        "- review_rounds: 6",
        "- task_attempts: 9",
        "- notify_cmd: curl -s http://host:8080/hook",
      ]),
    );
    expect(warnings).toEqual([]);
    expect(defaults).toEqual({
      model: "sonnet-4",
      max_turns: 60,
      review_rounds: 6,
      task_attempts: 9,
      notify_cmd: "curl -s http://host:8080/hook", // colons in the value survive
    });
  });

  it("absent section and partial keys are fine", () => {
    expect(parseDriverSection("## Goal\nx\n")).toEqual({ defaults: {}, warnings: [] });
    const { defaults, warnings } = parseDriverSection(goalMd(["- max_turns: 5"]));
    expect(warnings).toEqual([]);
    expect(defaults).toEqual({ max_turns: 5 });
  });

  it("unknown keys and bad values warn with the line number, never throw", () => {
    const text = goalMd(["- max_turn: 5", "- review_rounds: lots", "- just a note"]);
    const { defaults, warnings } = parseDriverSection(text);
    expect(defaults).toEqual({});
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toMatch(/unknown Driver key 'max_turn'/);
    expect(warnings[0]).toMatch(/GOAL\.md:\d+/);
    expect(warnings[1]).toMatch(/needs a non-negative number, got 'lots'/);
    expect(warnings[2]).toMatch(/no 'key: value' form/);
  });

  it("the shipped template parses clean", () => {
    const text = readFileSync(TEMPLATE, "utf8");
    const { defaults, warnings } = parseDriverSection(text);
    expect(warnings).toEqual([]); // example keys are commented out
    expect(defaults).toEqual({});
  });

  it("an unterminated <!-- is treated as literal text — it must not erase the checks below it", async () => {
    const text = [
      "# Goal",
      "",
      "## Goal",
      "Stray comment opener",
      "",
      "<!-- oops, never closed",
      "",
      "## Checks",
      "",
      "- `npm test`",
      "",
    ].join("\n");
    const p = mkGitProject({ "GOAL.md": text });
    cleanups.push(p.cleanup);
    const spec = await intake("", p.root);
    expect(spec.acceptance_checks).toEqual(["npm test"]); // human checks survive
  });

  it("commented-out example bullets never become live config or checks (template round-trip)", async () => {
    const text = readFileSync(TEMPLATE, "utf8");
    const p = mkGitProject({ "GOAL.md": text });
    cleanups.push(p.cleanup);
    const spec = await intake("", p.root);
    // the template's <!-- npm test / npm run lint / uv run pytest --> examples
    // under ## Checks must not be parsed as real acceptance
    expect(spec.acceptance_checks).toEqual(["true"]);
    expect(spec.driver_defaults).toEqual({});
  });
});

describe("precedence: flags > GOAL.md > defaults", () => {
  it("intake carries driver_defaults and initRun merges them under flags", async () => {
    const p = mkGitProject({ "GOAL.md": goalMd(["- max_turns: 60", "- review_rounds: 6"]) });
    cleanups.push(p.cleanup);
    const spec = await intake("", p.root);
    expect(spec.driver_defaults).toEqual({ max_turns: 60, review_rounds: 6 });

    // file value wins over the built-in default
    const fromFile = await initRun(spec, p.root);
    expect(fromFile.budgets.global_turns).toBe(60);
    expect(fromFile.budgets.review_rounds).toBe(6);
    expect(fromFile.budgets.task_attempts).toBeGreaterThan(0); // untouched default

    // explicit flag wins over the file
    const fromFlag = await initRun(spec, p.root, { global_turns: 3 });
    expect(fromFlag.budgets.global_turns).toBe(3);
    expect(fromFlag.budgets.review_rounds).toBe(6);
  });

  it("GOAL.md model is used when no --model flag is given (flag wins otherwise)", async () => {
    const goal = goalMd(["- model: file-model"]).replace("- `true`", "- `test -f out.txt`");
    const p = mkGitProject({ "GOAL.md": goal });
    cleanups.push(p.cleanup);

    const seenModels: Array<string | null> = [];
    const call = async (opts: { model?: string | null; mode?: string }): Promise<TurnResult> => {
      seenModels.push(opts.model ?? null);
      if (opts.mode === "ask") {
        // decompose / verdict consumers never reach here in this test (single objective task)
        return { sessionId: "s", finalText: "{}", usage: null, terminal: "success", exitCode: 0, timedOut: false };
      }
      writeFileSync(path.join(p.root, "out.txt"), "done");
      return { sessionId: "s", finalText: "done", usage: null, terminal: "success", exitCode: 0, timedOut: false };
    };

    const result = await runGoal({ root: p.root, budgets: { global_turns: 4, review_rounds: 0 }, call });
    expect(result.status).toBe("done");
    // the edit turn carried the GOAL.md model
    expect(seenModels).toContain("file-model");
  });
});

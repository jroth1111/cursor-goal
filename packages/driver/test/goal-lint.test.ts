import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatFindings, lintGoalMd } from "../src/driver/goal-lint.js";
import { mkGitProject } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

const TEMPLATE = fileURLToPath(new URL("../../../core/.cursor/goal/templates/GOAL.md", import.meta.url));

const CLEAN = ["# Goal", "", "## Goal", "Do the thing", "", "## Checks", "", "- `npm test`", ""].join("\n");

function at(findings: ReturnType<typeof lintGoalMd>, re: RegExp) {
  return findings.find((f) => re.test(f.message));
}

describe("GOAL.md lint", () => {
  it("a clean file has no findings", () => {
    expect(lintGoalMd(CLEAN)).toEqual([]);
    expect(formatFindings([])).toMatch(/clean/);
  });

  it("missing or empty Goal/Checks sections are errors", () => {
    const noGoal = lintGoalMd(["## Checks", "", "- `true`", ""].join("\n"));
    expect(at(noGoal, /missing '## Goal'/)).toMatchObject({ severity: "error" });

    const emptyGoal = lintGoalMd(["## Goal", "", "## Checks", "", "- `true`", ""].join("\n"));
    expect(at(emptyGoal, /no description text/)).toMatchObject({ severity: "error", line: 1 });

    const noChecks = lintGoalMd(["## Goal", "x", ""].join("\n"));
    expect(at(noChecks, /missing '## Checks'/)).toMatchObject({ severity: "error" });

    const emptyChecks = lintGoalMd(["## Goal", "x", "", "## Checks", "", "prose only", ""].join("\n"));
    expect(at(emptyChecks, /no check bullets/)).toMatchObject({ severity: "error", line: 4 });
  });

  it("prose-as-shell checks are errors with exact line numbers; unbackticked commands warn", () => {
    const text = [
      "## Goal",
      "x",
      "",
      "## Checks",
      "",
      "- `npm test`", // line 6: fine
      "- The server responds to all health probes", // line 7: prose -> error
      "- npm run lint", // line 8: command-like, unbackticked -> warning
      "",
    ].join("\n");
    const findings = lintGoalMd(text);
    const prose = at(findings, /looks like prose/);
    expect(prose).toMatchObject({ severity: "error", line: 7 });
    const style = at(findings, /not backticked/);
    expect(style).toMatchObject({ severity: "warning", line: 8 });
    expect(findings).toHaveLength(2);
  });

  it("prose detection is not defeated by hyphens, periods, or slashes inside the sentence", () => {
    const text = [
      "## Goal",
      "x",
      "",
      "## Checks",
      "",
      "- Make sure user-facing docs are updated", // hyphenated word
      "- The server responds to health probes.", // trailing period
      "- Verify the docs/ folder is complete", // slash mid-sentence
      "- ./scripts/check.sh --strict", // a real command stays a warning, not prose
      "",
    ].join("\n");
    const findings = lintGoalMd(text);
    expect(findings.filter((f) => /looks like prose/.test(f.message))).toHaveLength(3);
    expect(findings.filter((f) => /not backticked/.test(f.message))).toHaveLength(1);
  });

  it("dead scope paths are errors; globs are skipped", () => {
    const p = mkGitProject({ "src/keep.ts": "x" });
    cleanups.push(p.cleanup);
    const text = [
      "## Goal",
      "x",
      "",
      "## Scope",
      "",
      "- `src`", // exists
      "- `not-a-real-dir`", // line 7: dead -> error
      "- `src/**/*.ts`", // glob: skipped
      "",
      "## Checks",
      "",
      "- `true`",
      "",
    ].join("\n");
    const findings = lintGoalMd(text, p.root);
    const dead = at(findings, /does not exist/);
    expect(dead).toMatchObject({ severity: "error", line: 7 });
    expect(findings.filter((f) => /does not exist/.test(f.message))).toHaveLength(1);
  });

  it("duplicate sections error (the second is silently ignored at runtime); unknown sections warn", () => {
    const text = ["## Goal", "x", "", "## Checks", "", "- `true`", "", "## Checks", "", "- `false`", "", "## Custom", "y", ""].join("\n");
    const findings = lintGoalMd(text);
    const dup = at(findings, /duplicate '## Checks'/);
    expect(dup).toMatchObject({ severity: "error", line: 8 });
    expect(dup!.message).toMatch(/line 4/);
    expect(at(findings, /unknown section '## Custom'/)).toMatchObject({ severity: "warning", line: 12 });
  });

  it("Driver-section problems surface as warnings via the shared parser", () => {
    const text = ["## Goal", "x", "", "## Checks", "", "- `true`", "", "## Driver", "", "- max_turn: 5", ""].join("\n");
    const findings = lintGoalMd(text);
    const driver = at(findings, /unknown Driver key 'max_turn'/);
    expect(driver).toMatchObject({ severity: "warning", line: 10 });
  });

  it("commented-out examples never produce findings; the shipped template lints clean", () => {
    const withComment = [
      "## Goal",
      "x",
      "",
      "## Checks",
      "",
      "- `true`",
      "<!--",
      "- totally prose example that would otherwise error here",
      "-->",
      "",
    ].join("\n");
    expect(lintGoalMd(withComment)).toEqual([]);

    const template = readFileSync(TEMPLATE, "utf8");
    expect(lintGoalMd(template).filter((f) => f.severity === "error")).toEqual([]);
  });
});

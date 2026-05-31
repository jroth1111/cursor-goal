import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";

describe("I130 subcommand strict args", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("rejects stray goal, units, and mode subcommand args before normal output", async () => {
    const p = await mkGitProject("i130-subcommands");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship strict subcommand parsing.

## Work units

### unit-a
A
- \`scripts/a.py\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const cases = [
      { args: ["goal", "lint", "--fix"], error: /Unknown option: --fix/ },
      { args: ["units", "list", "--all"], error: /Unknown option: --all/ },
      { args: ["units", "bogus"], error: /Usage: cursor-goal units/ },
      { args: ["mode", "why", "--bogus"], error: /Usage: cursor-goal mode/ },
    ];

    for (const c of cases) {
      const r = spawnSync("node", [cli, ...c.args], {
        cwd: p.dir,
        encoding: "utf8",
        env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
      });

      expect(r.status, c.args.join(" ")).not.toBe(0);
      expect(r.stderr, c.args.join(" ")).toMatch(c.error);
      expect(r.stdout, c.args.join(" ")).not.toMatch(/unit-a|No triage log entry|warn:/);
    }
  });
});

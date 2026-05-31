import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";

describe("I20 unit acceptance auto-done", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("subagentStop marks unit done when acceptance passes", async () => {
    const p = await mkGitProject("i20");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### unit-a
Task
- \`src/a/\`
- acceptance: \`true\`
## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    const hook = path.resolve(import.meta.dirname, "../../dist/hook-subagentStop.mjs");
    spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        status: "completed",
        subagent_id: "sub-a",
        work_unit_id: "unit-a",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    const { readFile } = await import("node:fs/promises");
    const wu = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/work-units.json"), "utf8"),
    );
    const unit = wu.units.find((u: { id: string }) => u.id === "unit-a");
    expect(unit?.status).toBe("done");
  });
});

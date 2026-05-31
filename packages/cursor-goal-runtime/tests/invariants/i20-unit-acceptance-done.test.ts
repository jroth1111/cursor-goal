import { describe, it, expect, afterEach } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { markUnitInProgress } from "../../src/lib/work-units.js";

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
    const wu = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/work-units.json"), "utf8"),
    );
    const unit = wu.units.find((u: { id: string }) => u.id === "unit-a");
    expect(unit?.status).toBe("done");
  });

  it("subagentStop does not assign an unmatched subagent to the first in-progress unit", async () => {
    const p = await mkGitProject("i20-unmatched");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### unit-a
Task A
- \`src/a/\`
- acceptance: \`true\`
### unit-b
Task B
- \`src/b/\`
- acceptance: \`true\`
## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    expect(await markUnitInProgress("unit-a", "sub-a", p.dir)).toBe(true);

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-subagentStop.mjs");
    spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        status: "completed",
        subagent_id: "sub-b",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    const wu = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/work-units.json"), "utf8"),
    );
    const unitA = wu.units.find((u: { id: string }) => u.id === "unit-a");
    const unitB = wu.units.find((u: { id: string }) => u.id === "unit-b");
    expect(unitA?.status).toBe("in_progress");
    expect(unitA?.subagent_id).toBe("sub-a");
    expect(unitB?.status).toBe("pending");
    expect(existsSync(path.join(p.dir, ".cursor/goal/evidence/units/unit-a.jsonl"))).toBe(
      false,
    );
  });
});

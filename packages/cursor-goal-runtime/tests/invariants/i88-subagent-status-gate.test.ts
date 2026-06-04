import { describe, it, expect, afterEach } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { readWorkUnits } from "../../src/lib/work-units.js";

describe("I88 subagent status gate", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function setupUnit(scopePath: string): Promise<string> {
    const p = await mkGitProject("i88");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, scopePath), { recursive: true });
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### unit-a
Task
- \`${scopePath}\`
- acceptance: \`true\`
## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    return p.dir;
  }

  it("does not mark unit done when subagent status is failed", async () => {
    const dir = await setupUnit("src/a");
    const hook = path.resolve(import.meta.dirname, "../../dist/hook-subagentStop.mjs");
    spawnSync("node", [hook], {
      cwd: dir,
      input: JSON.stringify({
        status: "failed",
        subagent_id: "sub-a",
        work_unit_id: "unit-a",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: dir },
    });
    const wu = await readWorkUnits(dir);
    expect(wu?.units.find((u) => u.id === "unit-a")?.status).not.toBe("done");
  });

  it("marks unit done when subagent status is completed and acceptance passes", async () => {
    const dir = await setupUnit("src/b");
    const hook = path.resolve(import.meta.dirname, "../../dist/hook-subagentStop.mjs");
    spawnSync("node", [hook], {
      cwd: dir,
      input: JSON.stringify({
        status: "completed",
        subagent_id: "sub-b",
        work_unit_id: "unit-a",
        SUBAGENT_HANDOFF: {
          files_read: ["src/b/foo.ts"],
          claims: ["implemented feature"],
          evidence: ["acceptance passed"],
          uncertainty: [],
        },
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: dir },
    });
    const wu = await readWorkUnits(dir);
    expect(wu?.units.find((u) => u.id === "unit-a")?.status).toBe("done");
  });
});

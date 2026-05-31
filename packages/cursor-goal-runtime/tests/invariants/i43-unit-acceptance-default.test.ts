import { describe, it, expect, afterEach } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";

describe("I43 scope-based default unit acceptance", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("does not mark unit done until scope path exists", async () => {
    const p = await mkGitProject("i43");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### mod-a
A
- \`pkg/a/\`
## Checks
- \`false\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);

    const wu = JSON.parse(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(path.join(p.dir, ".cursor/goal/work-units.json"), "utf8"),
      ),
    );
    expect(wu.units[0].acceptance[0]).not.toBe("true");
    expect(String(wu.units[0].acceptance[0])).toMatch(/pkg\/a/);

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-subagentStop.mjs");
    spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        status: "completed",
        subagent_id: "sub-a",
        work_unit_id: "mod-a",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    let after = JSON.parse(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(path.join(p.dir, ".cursor/goal/work-units.json"), "utf8"),
      ),
    );
    expect(after.units[0].status).not.toBe("done");

    await mkdir(path.join(p.dir, "pkg/a"), { recursive: true });
    spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        status: "completed",
        subagent_id: "sub-a",
        work_unit_id: "mod-a",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    after = JSON.parse(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(path.join(p.dir, ".cursor/goal/work-units.json"), "utf8"),
      ),
    );
    expect(after.units[0].status).toBe("done");
  });
});

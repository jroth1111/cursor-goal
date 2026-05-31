import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { seedReleaseReady } from "../helpers/release-ready.js";

describe("I31 unit scoped acceptance", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("subagentStop marks unit done with default true acceptance while GOAL checks fail", async () => {
    const p = await mkGitProject("i31");
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
- acceptance: \`true\`
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
    expect(wu.units[0].acceptance).toEqual(["true"]);

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

    const after = JSON.parse(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(path.join(p.dir, ".cursor/goal/work-units.json"), "utf8"),
      ),
    );
    expect(after.units[0].status).toBe("done");

    await seedReleaseReady(p.dir);
    const stop = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(stop.kind).toBe("continue");
  });
});

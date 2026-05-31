import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { execCoreHook } from "../hooks/exec-hook.js";
import { readTrajectory } from "../../src/trajectory/fsm.js";

describe("I53 INTAKE write advisory mode", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("compile seeds DISCOVERY phase on fresh repo", async () => {
    const p = await mkGitProject("i53-compile");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    const traj = await readTrajectory(p.dir);
    expect(traj.phase).toBe("DISCOVERY");
  });

  it("allows Write in INTAKE phase", async () => {
    const p = await mkGitProject("i53-intake");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase: "INTAKE" }),
      "utf8",
    );
    const r = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: "src/x.ts",
    });
    expect(r.stdout.permission).toBe("allow");
  });
});

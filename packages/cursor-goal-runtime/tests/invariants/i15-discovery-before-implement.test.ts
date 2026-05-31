import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { execCoreHook } from "../hooks/exec-hook.js";
import { advancePhase } from "../../src/trajectory/fsm.js";

describe("I15 discovery before implement writes", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("allows Write in IMPLEMENT when discovery not complete", async () => {
    const p = await mkGitProject("i15");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase: "IMPLEMENT" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/discovery.json"),
      JSON.stringify({ completed: false, notes: "" }),
      "utf8",
    );
    const r = execCoreHook(p.dir, "preToolUse", { tool_name: "Write", file_path: "src/x.ts" });
    expect(r.stdout.permission).toBe("allow");
  });

  it("advancePhase to IMPLEMENT fails without discovery", async () => {
    const p = await mkGitProject("i15b");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase: "PLAN" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/discovery.json"),
      JSON.stringify({ completed: false, notes: "" }),
      "utf8",
    );
    const r = await advancePhase("IMPLEMENT", p.dir);
    expect(r.ok).toBe(false);
  });
});

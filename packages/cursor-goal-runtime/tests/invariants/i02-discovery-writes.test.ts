import { describe, it, expect, afterEach } from "vitest";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { execCoreHook } from "../hooks/exec-hook.js";

describe("I02 DISCOVERY advisory writes", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("allows Write when trajectory missing", async () => {
    const p = await mkGitProject("i02");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const r = execCoreHook(p.dir, "preToolUse", { tool_name: "Write" });
    expect(r.stdout.permission).toBe("allow");
  });

  it("allows Edit in DISCOVERY phase", async () => {
    const p = await mkGitProject("i02b");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      `${p.dir}/.cursor/goal/trajectory.json`,
      JSON.stringify({ phase: "DISCOVERY" }),
      "utf8",
    );
    const r = execCoreHook(p.dir, "preToolUse", { tool_name: "Edit" });
    expect(r.stdout.permission).toBe("allow");
  });
});

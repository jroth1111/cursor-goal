import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { execCoreHook } from "../hooks/exec-hook.js";
import { markEdit } from "../../src/lib/git-state.js";

describe("I11 edit marker", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("core postToolUse writes state.json on Write", async () => {
    const p = await mkGitProject("i11");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    execCoreHook(p.dir, "postToolUse", { tool_name: "Write" });
    expect(existsSync(path.join(p.dir, ".cursor/goal/state.json"))).toBe(true);
  });

  it("runtime markEdit writes state.json", async () => {
    const p = await mkGitProject("i11b");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await markEdit(p.dir);
    expect(existsSync(path.join(p.dir, ".cursor/goal/state.json"))).toBe(true);
  });
});

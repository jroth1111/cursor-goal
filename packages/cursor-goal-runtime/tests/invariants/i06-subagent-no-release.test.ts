import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { execCoreHook } from "../hooks/exec-hook.js";

describe("I06 subagentStop no RELEASE", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("subagentStop does not create RELEASE.json", async () => {
    const p = await mkGitProject("i06");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    execCoreHook(p.dir, "subagentStop", { status: "completed", agent: "sub" });
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(false);
  });
});

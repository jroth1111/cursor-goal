import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { execCoreHook } from "../hooks/exec-hook.js";

describe("I145 invalid direct work_unit_id path", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("does not write unit evidence outside evidence/units for invalid direct IDs", async () => {
    const p = await mkGitProject("i145-invalid-unit-id");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const escaped = path.join(p.dir, ".cursor/goal/evidence/escaped.jsonl");

    const post = execCoreHook(p.dir, "postToolUse", {
      tool_name: "Write",
      tool_input: { work_unit_id: "../escaped" },
      tool_output: "ok",
    });
    expect(post.exitCode, post.raw).toBe(0);
    expect(existsSync(escaped)).toBe(false);

    const stop = execCoreHook(p.dir, "subagentStop", {
      subagent_id: "sub-a",
      status: "completed",
      work_unit_id: "../escaped",
    });
    expect(stop.exitCode, stop.raw).toBe(0);
    expect(existsSync(escaped)).toBe(false);
  });
});

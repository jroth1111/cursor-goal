import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { execCoreHook } from "../hooks/exec-hook.js";

describe("I16 subagent goal governance writes", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("denies subagent Write to manifest.json", async () => {
    const p = await mkGitProject("i16");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const r = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: ".cursor/goal/manifest.json",
      is_subagent: true,
      work_unit_id: "u1",
    });
    expect(r.stdout.permission).toBe("deny");
  });

  it("allows subagent Write to unit evidence path", async () => {
    const p = await mkGitProject("i16b");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase: "IMPLEMENT" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/discovery.json"),
      JSON.stringify({ completed: true, notes: "ok" }),
      "utf8",
    );
    const r = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: ".cursor/goal/evidence/units/u1.jsonl",
      is_subagent: true,
    });
    expect(r.stdout.permission).toBe("allow");
  });
});

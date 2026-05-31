import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { execCoreHook, execCoreHookBare } from "../hooks/exec-hook.js";

describe("I161 subagent malformed work-unit state", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    restore = undefined;
    cleanup = undefined;
  });

  async function projectWithMalformedWorkUnits(name: string): Promise<{ dir: string }> {
    const p = await mkGitProject(name);
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await mkdir(path.join(p.dir, "src"), { recursive: true });
    await writeFile(path.join(p.dir, ".cursor/goal/work-units.json"), "{", "utf8");
    return p;
  }

  it("denies runtime subagent writes instead of crashing open on malformed work-units.json", async () => {
    const p = await projectWithMalformedWorkUnits("i161-runtime");
    const r = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: "src/outside.ts",
      is_subagent: true,
      work_unit_id: "unit-a",
    });

    expect(r.exitCode).toBe(0);
    expect(r.stdout.permission).toBe("deny");
    expect(String(r.stdout.agent_message ?? "")).toMatch(/Subagent WriteGate|cannot verify/i);
  });

  it("denies minimal fallback subagent writes when work-units.json is malformed", async () => {
    const p = await projectWithMalformedWorkUnits("i161-minimal");
    const r = execCoreHookBare(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: "src/outside.ts",
      is_subagent: true,
      work_unit_id: "unit-a",
    });

    expect(r.exitCode).toBe(0);
    expect(r.stdout.permission).toBe("deny");
    expect(String(r.stdout.agent_message ?? "")).toMatch(/Subagent WriteGate|cannot verify/i);
  });
});

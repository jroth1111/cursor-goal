import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { execCoreHook, execCoreHookBare } from "../hooks/exec-hook.js";

describe("I146 normalized governance paths", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("denies subagent writes that normalize from evidence/units to another governance file", async () => {
    const p = await mkGitProject("i146-governance-normalize");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, "src"), { recursive: true });
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Broad unit

## Work units

### broad
Broad unit
- \`**\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);

    const r = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: ".cursor/goal/evidence/units/../manifest.json",
      is_subagent: true,
      work_unit_id: "broad",
    });

    expect(r.stdout.permission).toBe("deny");
    expect(String(r.stdout.agent_message ?? "")).toMatch(/governance|evidence\/units/i);
  });

  it("denies minimal fallback subagent writes that normalize into governance space", async () => {
    const p = await mkGitProject("i146-minimal-governance-normalize");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const r = execCoreHookBare(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: ".cursor//goal/manifest.json",
      is_subagent: true,
      work_unit_id: "u1",
    });

    expect(r.stdout.permission).toBe("deny");
    expect(String(r.stdout.agent_message ?? "")).toMatch(/Subagent|governance|goal/i);
  });
});

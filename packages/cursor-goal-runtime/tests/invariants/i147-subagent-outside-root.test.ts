import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { execCoreHook, execCoreHookBare } from "../hooks/exec-hook.js";

describe("I147 subagent paths stay inside project root", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function seed(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
    const p = await mkGitProject("i147-outside-root");
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
    return p;
  }

  it("denies runtime subagent writes to absolute paths outside the project root", async () => {
    const p = await seed();
    const outside = path.join(path.dirname(p.dir), "outside-root-target.txt");

    const r = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: outside,
      is_subagent: true,
      work_unit_id: "broad",
    });

    expect(r.stdout.permission).toBe("deny");
    expect(String(r.stdout.agent_message ?? "")).toMatch(/outside project root/i);
  });

  it("denies runtime subagent evidence writes outside the project root", async () => {
    const p = await seed();
    const outside = path.join(
      path.dirname(p.dir),
      ".cursor/goal/evidence/units/broad.jsonl",
    );

    const r = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: outside,
      is_subagent: true,
      work_unit_id: "broad",
    });

    expect(r.stdout.permission).toBe("deny");
    expect(String(r.stdout.agent_message ?? "")).toMatch(/outside project root/i);
  });

  it("denies minimal hook subagent writes to absolute paths outside the project root", async () => {
    const p = await seed();
    const outside = path.join(path.dirname(p.dir), "outside-root-target.txt");

    const r = execCoreHookBare(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: outside,
      is_subagent: true,
      work_unit_id: "broad",
    });

    expect(r.stdout.permission).toBe("deny");
    expect(String(r.stdout.agent_message ?? "")).toMatch(/outside project root/i);
  });

  it("denies minimal hook subagent evidence writes outside the project root", async () => {
    const p = await seed();
    const outside = path.join(
      path.dirname(p.dir),
      ".cursor/goal/evidence/units/broad.jsonl",
    );

    const r = execCoreHookBare(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: outside,
      is_subagent: true,
      work_unit_id: "broad",
    });

    expect(r.stdout.permission).toBe("deny");
    expect(String(r.stdout.agent_message ?? "")).toMatch(/outside project root/i);
  });
});

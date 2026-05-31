import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { execCoreHook, execCoreHookBare } from "../hooks/exec-hook.js";

describe("I24 subagent unit scope WriteGate", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function seed(p: { dir: string }): Promise<void> {
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Two modules

## Work units

### mod-a
Module A
- \`pkg/a/\`

### mod-b
Module B
- \`pkg/b/\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
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
  }

  it("runtime preToolUse denies subagent Write outside unit scope", async () => {
    const p = await mkGitProject("i24");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seed(p);

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-preToolUse.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        tool_name: "Write",
        file_path: "pkg/b/outside.ts",
        is_subagent: true,
        work_unit_id: "mod-a",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    const out = JSON.parse((r.stdout ?? "{}").trim() || "{}");
    expect(out.permission).toBe("deny");
    expect(String(out.agent_message)).toMatch(/mod-a/i);
  });

  it("runtime preToolUse allows subagent Write inside unit scope", async () => {
    const p = await mkGitProject("i24b");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seed(p);

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-preToolUse.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        tool_name: "Write",
        file_path: "pkg/a/inside.ts",
        is_subagent: true,
        work_unit_id: "mod-a",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    const out = JSON.parse((r.stdout ?? "{}").trim() || "{}");
    expect(out.permission).toBe("allow");
  });

  it("runtime preToolUse handles absolute unit paths segment-safely", async () => {
    const p = await mkGitProject("i24-absolute-prefix");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seed(p);

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-preToolUse.mjs");
    const outside = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        tool_name: "Write",
        file_path: path.join(p.dir, "pkg/aa/outside.ts"),
        is_subagent: true,
        work_unit_id: "mod-a",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(JSON.parse((outside.stdout ?? "{}").trim() || "{}").permission).toBe("deny");

    const inside = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        tool_name: "Write",
        file_path: path.join(p.dir, "pkg/a/inside.ts"),
        is_subagent: true,
        work_unit_id: "mod-a",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(JSON.parse((inside.stdout ?? "{}").trim() || "{}").permission).toBe("allow");
  });

  it("runtime preToolUse denies dot-segment escape from unit scope", async () => {
    const p = await mkGitProject("i24-dot-segment");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seed(p);

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-preToolUse.mjs");
    const outside = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        tool_name: "Write",
        file_path: "pkg/a/../b/outside.ts",
        is_subagent: true,
        work_unit_id: "mod-a",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(JSON.parse((outside.stdout ?? "{}").trim() || "{}").permission).toBe("deny");
  });

  it("runtime preToolUse only allows exact unit evidence jsonl under goal governance", async () => {
    const p = await mkGitProject("i24-evidence-exact");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seed(p);

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-preToolUse.mjs");
    const suffix = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        tool_name: "Write",
        file_path: path.join(p.dir, ".cursor/goal/evidence/units/mod-a.jsonl.bak"),
        is_subagent: true,
        work_unit_id: "mod-a",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(JSON.parse((suffix.stdout ?? "{}").trim() || "{}").permission).toBe("deny");

    const exact = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        tool_name: "Write",
        file_path: path.join(p.dir, ".cursor/goal/evidence/units/mod-a.jsonl"),
        is_subagent: true,
        work_unit_id: "mod-a",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(JSON.parse((exact.stdout ?? "{}").trim() || "{}").permission).toBe("allow");
  });

  it("runtime preToolUse denies evidence-looking paths outside goal governance", async () => {
    const p = await mkGitProject("i24-evidence-outside-goal");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seed(p);

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-preToolUse.mjs");
    const outside = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        tool_name: "Write",
        file_path: "pkg/b/evidence/units/mod-a.jsonl",
        is_subagent: true,
        work_unit_id: "mod-a",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(JSON.parse((outside.stdout ?? "{}").trim() || "{}").permission).toBe("deny");
  });

  it("minimal hook denies subagent Write outside unit scope", async () => {
    const p = await mkGitProject("i24c");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seed(p);

    const r = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: "pkg/b/outside.ts",
      is_subagent: true,
      work_unit_id: "mod-a",
    });
    expect(r.stdout.permission).toBe("deny");
  });

  it("minimal hook handles absolute scope and evidence paths segment-safely", async () => {
    const p = await mkGitProject("i24-minimal-absolute");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seed(p);

    expect(
      execCoreHook(p.dir, "preToolUse", {
        tool_name: "Write",
        file_path: path.join(p.dir, "pkg/aa/outside.ts"),
        is_subagent: true,
        work_unit_id: "mod-a",
      }).stdout.permission,
    ).toBe("deny");
    expect(
      execCoreHook(p.dir, "preToolUse", {
        tool_name: "Write",
        file_path: path.join(p.dir, "pkg/a/inside.ts"),
        is_subagent: true,
        work_unit_id: "mod-a",
      }).stdout.permission,
    ).toBe("allow");
    expect(
      execCoreHook(p.dir, "preToolUse", {
        tool_name: "Write",
        file_path: "pkg/a/../b/outside.ts",
        is_subagent: true,
        work_unit_id: "mod-a",
      }).stdout.permission,
    ).toBe("deny");
    expect(
      execCoreHook(p.dir, "preToolUse", {
        tool_name: "Write",
        file_path: path.join(p.dir, ".cursor/goal/evidence/units/mod-a.jsonl.bak"),
        is_subagent: true,
        work_unit_id: "mod-a",
      }).stdout.permission,
    ).toBe("deny");
  });

  it("minimal hook denies evidence-looking paths outside goal governance", async () => {
    const p = await mkGitProject("i24-minimal-evidence-outside-goal");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seed(p);

    expect(
      execCoreHookBare(p.dir, "preToolUse", {
        tool_name: "Write",
        file_path: "pkg/b/evidence/units/mod-a.jsonl",
        is_subagent: true,
        work_unit_id: "mod-a",
      }).stdout.permission,
    ).toBe("deny");
  });
});

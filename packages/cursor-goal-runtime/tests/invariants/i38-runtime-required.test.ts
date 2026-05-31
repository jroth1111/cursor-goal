import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { execCoreHookBare, execCoreHookWithMinimalEnv } from "../hooks/exec-hook.js";

describe("I38 hooks fail open without runtime", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function seedGoal(p: { dir: string }): Promise<void> {
    await writeFile(path.join(p.dir, "GOAL.md"), "## Goal\nx\n## Checks\n- `true`\n", "utf8");
  }

  it("preToolUse allows when runtime is missing", async () => {
    const p = await mkGitProject("i38");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedGoal(p);

    const r = execCoreHookBare(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: "src/x.ts",
    });
    expect(r.stdout.permission).toBe("allow");
    expect(String(r.stdout.agent_message)).toMatch(/runtime not built/);
  });

  it("beforeSubmitPrompt continues when runtime is missing", async () => {
    const p = await mkGitProject("i38b");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedGoal(p);

    const r = execCoreHookBare(p.dir, "beforeSubmitPrompt", {});
    expect(r.stdout.continue).toBe(true);
    expect(String(r.stdout.agent_message)).toMatch(/runtime not built/);
  });

  it("beforeShellExecution still denies destructive shell when runtime is missing", async () => {
    const p = await mkGitProject("i38-destructive");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedGoal(p);

    const r = execCoreHookBare(p.dir, "beforeShellExecution", {
      command: "rm -rf /tmp/cursor-goal-nope",
    });
    expect(r.stdout.permission).toBe("deny");
    expect(String(r.stdout.agent_message ?? "")).toMatch(/destructive/i);
  });

  it("beforeShellExecution destructive denial does not depend on jq", async () => {
    const p = await mkGitProject("i38-destructive-no-jq");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedGoal(p);

    const home = mkdtempSync(path.join(os.tmpdir(), "i38-home-"));
    const bin = mkdtempSync(path.join(os.tmpdir(), "i38-bin-"));
    await writeFile(path.join(bin, "jq"), "#!/bin/sh\nexit 127\n", { mode: 0o755 });

    try {
      const script = path.resolve(
        import.meta.dirname,
        "../../../../core/.cursor/hooks/goal-shell.sh",
      );
      const r = spawnSync("bash", [script], {
        cwd: p.dir,
        input: JSON.stringify({ command: "rm -rf /tmp/cursor-goal-nope" }),
        encoding: "utf8",
        env: {
          ...process.env,
          CURSOR_PROJECT_DIR: p.dir,
          HOME: home,
          PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
        },
      });
      expect(r.status).toBe(0);
      expect(JSON.parse((r.stdout ?? "{}").trim() || "{}").permission).toBe("deny");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it("falls back to minimal safety when the node runtime hook fails", async () => {
    const p = await mkGitProject("i38-broken-runtime");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedGoal(p);

    const runtime = mkdtempSync(path.join(os.tmpdir(), "i38-runtime-"));
    await mkdir(path.join(runtime, "dist"), { recursive: true });
    await writeFile(
      path.join(runtime, "dist/hook-beforeShellExecution.mjs"),
      "throw new Error('broken runtime');\n",
      "utf8",
    );

    try {
      const script = path.resolve(
        import.meta.dirname,
        "../../../../core/.cursor/hooks/goal-shell.sh",
      );
      const r = spawnSync("bash", [script], {
        cwd: p.dir,
        input: JSON.stringify({ command: "rm -rf /tmp/cursor-goal-nope" }),
        encoding: "utf8",
        env: {
          ...process.env,
          CURSOR_PROJECT_DIR: p.dir,
          CURSOR_GOAL_RUNTIME: runtime,
        },
      });
      expect(r.status).toBe(0);
      expect(JSON.parse((r.stdout ?? "{}").trim() || "{}").permission).toBe("deny");
    } finally {
      rmSync(runtime, { recursive: true, force: true });
    }
  });

  it("CURSOR_GOAL_ALLOW_MINIMAL=1 is tolerated as a legacy no-op", async () => {
    const p = await mkGitProject("i38c");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedGoal(p);

    const r = execCoreHookWithMinimalEnv(p.dir, "beforeSubmitPrompt", {});
    expect(r.stdout.continue).toBe(true);
  });
});

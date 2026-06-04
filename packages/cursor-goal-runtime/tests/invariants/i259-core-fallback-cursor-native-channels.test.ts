import { describe, it, expect, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { execCoreHookBare, execCoreHookWithMinimalEnv } from "../hooks/exec-hook.js";

describe("I259 core fallback uses Cursor-native hook channels", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;
  const prevStrict = process.env.CURSOR_GOAL_STRICT;
  const prevRuntime = process.env.CURSOR_GOAL_RUNTIME;

  afterEach(async () => {
    if (prevStrict === undefined) delete process.env.CURSOR_GOAL_STRICT;
    else process.env.CURSOR_GOAL_STRICT = prevStrict;
    if (prevRuntime === undefined) delete process.env.CURSOR_GOAL_RUNTIME;
    else process.env.CURSOR_GOAL_RUNTIME = prevRuntime;
    restore?.();
    await cleanup?.();
  });

  async function seedGoal(dir: string): Promise<void> {
    await writeFile(path.join(dir, "GOAL.md"), "## Goal\nx\n## Checks\n- `true`\n", "utf8");
  }

  it("keeps no-runtime diagnostics out of ignored beforeSubmitPrompt agent_message", async () => {
    const p = await mkGitProject("i259-core-channels");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedGoal(p.dir);
    delete process.env.CURSOR_GOAL_STRICT;
    delete process.env.CURSOR_GOAL_RUNTIME;

    const session = execCoreHookBare(p.dir, "sessionStart", {});
    expect(session.stdout.agent_message).toBeUndefined();
    expect(String(session.stdout.additional_context ?? "")).toMatch(/runtime not built/i);

    const prompt = execCoreHookBare(p.dir, "beforeSubmitPrompt", { prompt: "continue" });
    expect(prompt.stdout.continue).toBe(true);
    expect(prompt.stdout.agent_message).toBeUndefined();
    expect(prompt.stdout.user_message).toBeUndefined();
  });

  it("uses user_message for strict core beforeSubmitPrompt blocks", async () => {
    const p = await mkGitProject("i259-core-strict");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedGoal(p.dir);
    process.env.CURSOR_GOAL_STRICT = "1";
    delete process.env.CURSOR_GOAL_RUNTIME;

    const prompt = execCoreHookBare(p.dir, "beforeSubmitPrompt", { prompt: "continue" });
    expect(prompt.stdout.continue).toBe(false);
    expect(prompt.stdout.agent_message).toBeUndefined();
    expect(String(prompt.stdout.user_message ?? "")).toMatch(/STRICT|runtime not built/i);
  });

  it("uses user_message for strict beforeSubmitPrompt root-resolution failures", async () => {
    const p = await mkGitProject("i259-root-resolution");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), "i259-fake-home-"));
    const fakeHooks = path.join(fakeHome, ".cursor", "hooks");
    await mkdir(fakeHooks, { recursive: true });
    const script = path.resolve(
      import.meta.dirname,
      "../../../../core/.cursor/hooks/goal-prompt.sh",
    );

    const r = spawnSync("bash", [script], {
      cwd: fakeHooks,
      input: JSON.stringify({ prompt: "continue" }),
      encoding: "utf8",
      env: {
        ...process.env,
        CURSOR_HOME: path.join(fakeHome, ".cursor"),
        CURSOR_GOAL_STRICT: "1",
        CURSOR_PROJECT_DIR: "",
      },
    });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse((r.stdout ?? "{}").trim() || "{}") as {
      continue?: boolean;
      user_message?: string;
      agent_message?: string;
    };
    expect(out.continue).toBe(false);
    expect(out.agent_message).toBeUndefined();
    expect(out.user_message ?? "").toMatch(/CURSOR_PROJECT_DIR|global hooks directory/i);
    await rm(fakeHome, { recursive: true, force: true });
  });

  it("keeps non-strict beforeSubmitPrompt root-resolution failures silent", async () => {
    const p = await mkGitProject("i259-root-resolution-open");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), "i259-fake-home-open-"));
    const fakeHooks = path.join(fakeHome, ".cursor", "hooks");
    await mkdir(fakeHooks, { recursive: true });
    const script = path.resolve(
      import.meta.dirname,
      "../../../../core/.cursor/hooks/goal-prompt.sh",
    );

    const r = spawnSync("bash", [script], {
      cwd: fakeHooks,
      input: JSON.stringify({ prompt: "continue" }),
      encoding: "utf8",
      env: {
        ...process.env,
        CURSOR_HOME: path.join(fakeHome, ".cursor"),
        CURSOR_GOAL_STRICT: "",
        CURSOR_PROJECT_DIR: "",
      },
    });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse((r.stdout ?? "{}").trim() || "{}") as {
      continue?: boolean;
      user_message?: string;
      agent_message?: string;
    };
    expect(out.continue).toBe(true);
    expect(out.agent_message).toBeUndefined();
    expect(out.user_message).toBeUndefined();
    await rm(fakeHome, { recursive: true, force: true });
  });

  it("keeps minimal PAUSED beforeSubmitPrompt advisory out of ignored agent_message", async () => {
    const p = await mkGitProject("i259-paused-minimal");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedGoal(p.dir);
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(path.join(p.dir, ".cursor/goal/PAUSED"), "", "utf8");

    const prompt = execCoreHookWithMinimalEnv(p.dir, "beforeSubmitPrompt", { prompt: "continue" });
    expect(prompt.exitCode).toBe(0);
    expect(prompt.stdout.continue).toBe(true);
    expect(prompt.stdout.agent_message).toBeUndefined();
    expect(prompt.stdout.user_message).toBeUndefined();
  });
});

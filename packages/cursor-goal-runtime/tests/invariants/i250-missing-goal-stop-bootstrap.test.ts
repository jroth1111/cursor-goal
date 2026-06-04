import { describe, it, expect, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { writeSessionMode } from "../../src/lib/governance-config.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { execCoreHook, execMinimalStop } from "../hooks/exec-hook.js";
import { hasAgentDisposition } from "../../src/lib/disposition.js";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

describe("I250 missing GOAL stop bootstrap", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("idles instead of injecting a missing-GOAL followup task", async () => {
    const p = await mkGitProject("i250-missing-goal-stop");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeSessionMode(p.dir, "governed", "triage");

    const result = await runStopVerifier({
      status: "completed",
      loop_count: 0,
      conversation_id: "missing-goal-agent",
    });
    expect(result.kind).toBe("idle");

    const hook = execCoreHook(p.dir, "stop", {
      status: "completed",
      loop_count: 0,
      conversation_id: "missing-goal-agent",
    });
    expect(hook.exitCode).toBe(0);
    expect(hook.stdout.followup_message).toBeUndefined();
    expect(hook.raw).toBe("{}");
    expect(await hasAgentDisposition(p.dir, "missing-goal-agent")).toBe(false);

    const minimal = execMinimalStop(p.dir, {
      status: "completed",
      loop_count: 0,
      conversation_id: "missing-goal-agent",
    });
    expect(minimal.exitCode).toBe(0);
    expect(minimal.stdout.followup_message).toBeUndefined();
    expect(minimal.raw).toBe("{}");
  });

  it("idles stop root-resolution failures instead of injecting bootstrap text", async () => {
    const hooksDir = path.resolve(
      import.meta.dirname,
      "../../../../core/.cursor/hooks",
    );
    const cursorHome = path.join(
      os.tmpdir(),
      `i250-root-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const fakeHooks = path.join(cursorHome, "hooks");
    await mkdir(fakeHooks, { recursive: true });
    const r = spawnSync("bash", [path.join(hooksDir, "verify-minimal.sh"), "stop"], {
      cwd: fakeHooks,
      input: JSON.stringify({
        status: "completed",
        loop_count: 0,
        conversation_id: "missing-root-agent",
      }),
      encoding: "utf8",
      env: {
        ...process.env,
        CURSOR_HOME: cursorHome,
        CURSOR_PROJECT_DIR: "",
      },
    });
    await rm(cursorHome, { recursive: true, force: true });
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout.trim()).toBe("{}");
  });
});

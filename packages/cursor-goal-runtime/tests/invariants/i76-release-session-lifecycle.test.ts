import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { seedReleaseReady } from "../helpers/release-ready.js";
import { execMinimalStop } from "../hooks/exec-hook.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { readAgentRuntimeState, writeAgentRuntimeState } from "../../src/lib/agent-runtime-state.js";
import { readRepoBlockedStopTotal } from "../../src/lib/goal-loop.js";
import { passportsDir, writeJson } from "../../src/lib/paths.js";
import { sessionEndMarkerPath } from "../../src/lib/disposition.js";

describe("I76 release/session terminal lifecycle", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    restore = undefined;
    cleanup = undefined;
  });

  it("runtime RELEASE clears a stale SESSION_END marker", async () => {
    const p = await mkGitProject("i76-runtime-clears-session-end");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await writeJson(sessionEndMarkerPath(p.dir), {
      status: "SESSION_END",
      reason: "old-session",
    });

    const r = await runStopVerifier({
      status: "completed",
      loop_count: 0,
      conversation_id: "agent-a",
    });

    expect(r.kind).toBe("release");
    expect(existsSync(path.join(passportsDir(p.dir), "RELEASE.json"))).toBe(true);
    expect(existsSync(sessionEndMarkerPath(p.dir))).toBe(false);
  });

  it("minimal RELEASE clears a stale SESSION_END marker", async () => {
    const p = await mkGitProject("i76-minimal-clears-session-end");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await writeJson(sessionEndMarkerPath(p.dir), {
      status: "SESSION_END",
      reason: "old-session",
    });

    const r = execMinimalStop(p.dir, {
      status: "completed",
      loop_count: 0,
      conversation_id: "agent-a",
    });

    expect(r.exitCode).toBe(0);
    expect(existsSync(path.join(passportsDir(p.dir), "RELEASE.json"))).toBe(true);
    expect(existsSync(sessionEndMarkerPath(p.dir))).toBe(false);
  });

  it("runtime RELEASE does not reset state when its passport cannot be prepared", async () => {
    const p = await mkGitProject("i76-release-prepare-failure");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await writeFile(
      path.join(p.dir, ".cursor/goal/goal-loop.json"),
      JSON.stringify({
        total_blocked_stops: 5,
        loop_limit: 40,
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );
    await writeAgentRuntimeState(p.dir, "agent-a", {
      mode: "runtime",
      loop_count: 5,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: true,
      blockers: ["old"],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });
    await mkdir(path.join(passportsDir(p.dir), "RELEASE.json"));

    await expect(
      runStopVerifier({
        status: "completed",
        loop_count: 0,
        conversation_id: "agent-a",
      }),
    ).rejects.toThrow();

    expect(await readRepoBlockedStopTotal(p.dir)).toBe(5);
    const agent = await readAgentRuntimeState(p.dir, "agent-a");
    expect(agent?.blocked).toBe(true);
    expect(agent?.loop_count).toBe(5);
  });

  it("runtime sessionEnd creates passport directories before writing SESSION_END", async () => {
    const p = await mkGitProject("i76-session-end-dirs");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-sessionEnd.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ conversation_id: "agent-a" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).toBe(0);
    expect(JSON.parse((r.stdout ?? "{}").trim() || "{}")).toEqual({});
    expect(existsSync(sessionEndMarkerPath(p.dir))).toBe(true);
  });
});

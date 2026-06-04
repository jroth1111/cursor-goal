import { describe, it, expect, afterEach } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import {
  readAgentRuntimeState,
  writeAgentRuntimeState,
} from "../../src/lib/agent-runtime-state.js";
import {
  readRepoBlockedStopTotal,
  goalLoopPath,
} from "../../src/lib/goal-loop.js";
import {
  readRepoRuntimeSummary,
  readRuntimeState,
  runtimeStatePath,
} from "../../src/lib/runtime-state.js";
import { isGovernanceActive } from "../../src/lib/governance-active.js";
import { buildOperatorSnapshot } from "../../src/lib/operator.js";
import { seedReleaseReady } from "../helpers/release-ready.js";

describe("I59 runtime-state multi-agent fixes", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("seeds repo total from runtime-state.json total_blocked_stops when goal-loop missing", async () => {
    const p = await mkGitProject("i59-seed");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      runtimeStatePath(p.dir),
      JSON.stringify({
        mode: "runtime",
        total_blocked_stops: 12,
        loop_limit: 40,
        phase: "VERIFY",
        blocked_agent_count: 1,
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );
    expect(existsSync(goalLoopPath(p.dir))).toBe(false);
    expect(await readRepoBlockedStopTotal(p.dir)).toBe(12);
  });

  it("readRuntimeState without agentId returns repo view when agents blocked", async () => {
    const p = await mkGitProject("i59-read");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      runtimeStatePath(p.dir),
      JSON.stringify({
        mode: "runtime",
        total_blocked_stops: 3,
        loop_limit: 40,
        phase: "VERIFY",
        blocked_agent_count: 2,
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );
    for (const id of ["agent-a", "agent-b"]) {
      await writeAgentRuntimeState(p.dir, id, {
        mode: "runtime",
        loop_count: 1,
        loop_limit: 40,
        phase: "VERIFY",
        blocked: true,
        blockers: ["x"],
        next_action: null,
        last_check_fail: null,
        updated_at: new Date().toISOString(),
      });
    }
    const state = await readRuntimeState(p.dir);
    expect(state).not.toBeNull();
    expect(state?.blocked).toBe(true);
    expect(state?.loop_count).toBe(3);
  });

  it("RELEASE clears blocked on all agents but preserves other agents loop_count", async () => {
    const p = await mkGitProject("i59-release-preserve");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);

    await writeAgentRuntimeState(p.dir, "agent-a", {
      mode: "runtime",
      loop_count: 0,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: false,
      blockers: [],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });
    await writeAgentRuntimeState(p.dir, "agent-b", {
      mode: "runtime",
      loop_count: 7,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: true,
      blockers: ["npm test"],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });

    await runStopVerifier({ status: "completed", loop_count: 0, conversation_id: "agent-a" });
    const b = await readAgentRuntimeState(p.dir, "agent-b");
    expect(b?.blocked).toBe(false);
    expect(b?.loop_count).toBe(7);
    expect(await readRepoBlockedStopTotal(p.dir)).toBe(0);
  });

  it("compile clears agent blocked flags (invalidateRuntimeState)", async () => {
    const p = await mkGitProject("i59-compile-unblock");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeAgentRuntimeState(p.dir, "default", {
      mode: "runtime",
      loop_count: 2,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: true,
      blockers: ["x"],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    expect((await readAgentRuntimeState(p.dir, "default"))?.blocked).toBe(false);
    expect((await readAgentRuntimeState(p.dir, "default"))?.loop_count).toBe(2);
  });

  it("governance active for blocked agent only (chat session)", async () => {
    const p = await mkGitProject("i59-gov");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "GOAL.md"), "## Goal\nx\n", "utf8");
    await writeFile(
      path.join(p.dir, ".cursor/goal/session-mode.json"),
      JSON.stringify({ mode: "chat", at: new Date().toISOString(), source: "test" }),
      "utf8",
    );
    await writeAgentRuntimeState(p.dir, "agent-a", {
      mode: "runtime",
      loop_count: 1,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: true,
      blockers: ["x"],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });

    expect(await isGovernanceActive(p.dir, "agent-a")).toBe(true);
    expect(await isGovernanceActive(p.dir, "agent-b")).toBe(false);
  });

  it("operator snapshot uses per-agent loop_count", async () => {
    const p = await mkGitProject("i59-op");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeAgentRuntimeState(p.dir, "agent-z", {
      mode: "runtime",
      loop_count: 4,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: true,
      blockers: ["false"],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });
    await writeFile(
      goalLoopPath(p.dir),
      JSON.stringify({ total_blocked_stops: 99, loop_limit: 40, updated_at: new Date().toISOString() }),
      "utf8",
    );

    const snap = await buildOperatorSnapshot(p.dir, { conversation_id: "agent-z" });
    expect("error" in snap).toBe(false);
    if (!("error" in snap)) {
      expect(snap.loop_count).toBe(4);
    }
  });

  it("I60: disposition is per-agent; other conversation may submit", async () => {
    const p = await mkGitProject("i60-disp-agent");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    const { writeAgentDisposition } = await import("../../src/lib/disposition.js");
    await writeAgentDisposition(p.dir, "agent-a", {
      status: "DISPOSITION",
      recoverable: true,
      failed: ["x"],
      loop_count: 38,
      agent_id: "agent-a",
      at: new Date().toISOString(),
    });

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-beforeSubmitPrompt.mjs");
    const warned = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ prompt: "ship it", conversation_id: "agent-a" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    const warnedOut = JSON.parse((warned.stdout ?? "{}").trim());
    expect(warnedOut.continue).toBe(true);
    expect(warnedOut.agent_message).toBeUndefined();
    expect(warnedOut.user_message).toBeUndefined();

    const allow = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ prompt: "ship it", conversation_id: "agent-b" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(JSON.parse((allow.stdout ?? "{}").trim()).continue).toBe(true);
  });

  it("minimal fallback preserves blocked state on other agents when checks pass", async () => {
    const p = await mkGitProject("i59-minimal");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    const hookPath = path.resolve(
      import.meta.dirname,
      "../../../../core/.cursor/hooks/verify-minimal.sh",
    );
    await mkdir(path.join(p.dir, ".cursor/goal/agents/agent-b"), { recursive: true });
    await writeAgentRuntimeState(p.dir, "agent-b", {
      mode: "minimal",
      loop_count: 5,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: true,
      blockers: ["x"],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });

    const r = spawnSync("bash", [hookPath, "stop"], {
      cwd: p.dir,
      input: JSON.stringify({ status: "completed", loop_count: 0, conversation_id: "agent-a" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir, CURSOR_GOAL_ALLOW_MINIMAL: "1" },
    });
    expect(r.status).toBe(0);
    const b = await readAgentRuntimeState(p.dir, "agent-b");
    expect(b?.blocked).toBe(true);
    expect(b?.loop_count).toBe(5);
    const summary = await readRepoRuntimeSummary(p.dir);
    expect(summary?.total_blocked_stops ?? 0).toBe(0);
  });
});

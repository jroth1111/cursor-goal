import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { countSubmitBlockedAgents } from "../../src/lib/agent-runtime-state.js";
import {
  goalLoopPath,
  incrementRepoBlockedStopTotal,
  readRepoBlockedStopTotal,
} from "../../src/lib/goal-loop.js";
import { writeAgentDisposition } from "../../src/lib/disposition.js";
import { buildOperatorSnapshot } from "../../src/lib/operator.js";
import {
  readRepoRuntimeSummary,
  readRuntimeState,
  runtimeStatePath,
} from "../../src/lib/runtime-state.js";
import { seedReleaseReady } from "../helpers/release-ready.js";
import { runStopVerifier } from "../../src/lib/verify.js";
describe("I61 runtime-state P2 fixes", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("countSubmitBlockedAgents includes disposition without blocked handoff", async () => {
    const p = await mkGitProject("i61-disp-count");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeAgentDisposition(p.dir, "agent-a", {
      status: "DISPOSITION",
      recoverable: true,
      failed: ["x"],
      loop_count: 5,
      agent_id: "agent-a",
      at: new Date().toISOString(),
    });
    expect(countSubmitBlockedAgents(p.dir)).toBe(1);
  });

  it("readRuntimeState without agentId reflects disposition-only blocks", async () => {
    const p = await mkGitProject("i61-read-disp");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeAgentDisposition(p.dir, "agent-a", {
      status: "DISPOSITION",
      recoverable: true,
      failed: ["x"],
      loop_count: 5,
      agent_id: "agent-a",
      at: new Date().toISOString(),
    });
    const state = await readRuntimeState(p.dir);
    expect(state?.blocked).toBe(true);
    expect(state?.blockers[0]).toContain("submit-blocked");
  });

  it("RELEASE leaves repo summary blocked when another agent is in disposition", async () => {
    const p = await mkGitProject("i61-release-disp");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await writeAgentDisposition(p.dir, "agent-b", {
      status: "DISPOSITION",
      recoverable: true,
      failed: ["x"],
      loop_count: 38,
      agent_id: "agent-b",
      at: new Date().toISOString(),
    });

    await runStopVerifier({ status: "completed", loop_count: 0, conversation_id: "agent-a" });
    const summary = await readRepoRuntimeSummary(p.dir);
    expect(summary?.blocked_agent_count).toBeGreaterThanOrEqual(1);
    expect(countSubmitBlockedAgents(p.dir)).toBe(1);
  });

  it("compile invalidation resets goal-loop and rebuilds repo summary under lock", async () => {
    const p = await mkGitProject("i61-compile-reset");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeFile(
      goalLoopPath(p.dir),
      JSON.stringify({ total_blocked_stops: 17, loop_limit: 40, updated_at: new Date().toISOString() }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    expect(await readRepoBlockedStopTotal(p.dir)).toBe(0);
    expect(existsSync(runtimeStatePath(p.dir))).toBe(true);
    const summary = await readRepoRuntimeSummary(p.dir);
    expect(summary?.total_blocked_stops).toBe(0);
  });

  it("ignores malformed goal-loop totals and falls back to legacy runtime-state", async () => {
    const p = await mkGitProject("i61-malformed-goal-loop");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      goalLoopPath(p.dir),
      JSON.stringify({ total_blocked_stops: "oops", loop_limit: 40 }),
      "utf8",
    );
    await writeFile(
      runtimeStatePath(p.dir),
      JSON.stringify({
        mode: "runtime",
        loop_count: 7,
        loop_limit: 40,
        phase: "VERIFY",
        blocked: true,
        blockers: [],
        next_action: null,
        last_check_fail: null,
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );

    expect(await readRepoBlockedStopTotal(p.dir)).toBe(7);
    expect(await incrementRepoBlockedStopTotal(p.dir)).toBe(8);
  });

  it("readRepoRuntimeSummary overlays stale blocked_agent_count from disk", async () => {
    const p = await mkGitProject("i61-summary-live");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      runtimeStatePath(p.dir),
      JSON.stringify({
        mode: "runtime",
        total_blocked_stops: 0,
        loop_limit: 40,
        phase: "VERIFY",
        blocked_agent_count: 0,
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );
    await writeAgentDisposition(p.dir, "agent-stale", {
      status: "DISPOSITION",
      recoverable: true,
      failed: ["x"],
      loop_count: 10,
      agent_id: "agent-stale",
      at: new Date().toISOString(),
    });
    const summary = await readRepoRuntimeSummary(p.dir);
    expect(summary?.blocked_agent_count).toBe(1);
    const state = await readRuntimeState(p.dir);
    expect(state?.blocked).toBe(true);
  });

  it("readRepoRuntimeSummary overlays stale loop_limit from live config", async () => {
    const p = await mkGitProject("i61-summary-live-limit");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/manifest.json"),
      JSON.stringify({ loop_limit: 7 }),
      "utf8",
    );
    await writeFile(
      runtimeStatePath(p.dir),
      JSON.stringify({
        mode: "runtime",
        total_blocked_stops: 2,
        loop_limit: 40,
        phase: "VERIFY",
        blocked_agent_count: 0,
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );

    const summary = await readRepoRuntimeSummary(p.dir);
    expect(summary?.loop_limit).toBe(7);
    const state = await readRuntimeState(p.dir);
    expect(state?.loop_limit).toBe(7);
  });

  it("readRuntimeState with agentId reflects disposition-only submit block", async () => {
    const p = await mkGitProject("i61-agent-disp");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeAgentDisposition(p.dir, "agent-d", {
      status: "DISPOSITION",
      recoverable: true,
      failed: ["check-fail"],
      loop_count: 38,
      agent_id: "agent-d",
      at: new Date().toISOString(),
    });
    const state = await readRuntimeState(p.dir, { agentId: "agent-d" });
    expect(state?.blocked).toBe(true);
    expect(state?.blockers).toContain("disposition:required");
    expect(state?.blockers).toContain("check-fail");
  });

  it("buildOperatorSnapshot blocked when checks pass but disposition active", async () => {
    const p = await mkGitProject("i61-op-disp");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await writeAgentDisposition(p.dir, "agent-op", {
      status: "DISPOSITION",
      recoverable: true,
      failed: ["budget"],
      loop_count: 38,
      agent_id: "agent-op",
      at: new Date().toISOString(),
    });
    const snap = await buildOperatorSnapshot(p.dir, { agentId: "agent-op" });
    expect("error" in snap).toBe(false);
    if (!("error" in snap)) {
      expect(snap.blocked).toBe(true);
      expect(snap.blockers).toContain("disposition:required");
    }
  });

  it("compile keeps disposition agents in blocked_agent_count", async () => {
    const p = await mkGitProject("i61-compile-disp-count");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeAgentDisposition(p.dir, "agent-x", {
      status: "DISPOSITION",
      recoverable: true,
      failed: ["x"],
      loop_count: 10,
      agent_id: "agent-x",
      at: new Date().toISOString(),
    });
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n- `false`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    const summary = await readRepoRuntimeSummary(p.dir);
    expect(summary?.blocked_agent_count).toBe(1);
  });
});

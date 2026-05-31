import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import {
  readAgentRuntimeState,
  writeAgentRuntimeState,
} from "../../src/lib/agent-runtime-state.js";
import { readRepoBlockedStopTotal, incrementRepoBlockedStopTotal } from "../../src/lib/goal-loop.js";
import { readRepoRuntimeSummary } from "../../src/lib/runtime-state.js";
import { seedReleaseReady } from "../helpers/release-ready.js";

describe("I56 multi-agent runtime state", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("I56a: parallel repo stop increments do not lose counts", async () => {
    const p = await mkGitProject("i56-lock");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => incrementRepoBlockedStopTotal(p.dir)),
    );
    expect(results).toHaveLength(20);
    expect(await readRepoBlockedStopTotal(p.dir)).toBe(20);
  });

  it("I57: beforeSubmit warns only the blocked conversation", async () => {
    const p = await mkGitProject("i57-submit");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    const limit = 40;

    await writeAgentRuntimeState(p.dir, "agent-a", {
      mode: "runtime",
      loop_count: 1,
      loop_limit: limit,
      phase: "VERIFY",
      blocked: true,
      blockers: ["npm test"],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-beforeSubmitPrompt.mjs");

    const warned = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ prompt: "implement feature", conversation_id: "agent-a" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    const warnedOut = JSON.parse((warned.stdout ?? "{}").trim());
    expect(warnedOut.continue).toBe(true);
    expect(String(warnedOut.agent_message ?? "")).toMatch(/blocker|blocked/i);

    const allow = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ prompt: "implement feature", conversation_id: "agent-b" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(JSON.parse((allow.stdout ?? "{}").trim()).continue).toBe(true);
  });

  it("I58: disposition warns only the stopping agent", async () => {
    const p = await mkGitProject("i58-disp");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);

    const r = await runStopVerifier({
      status: "completed",
      loop_count: 38,
      conversation_id: "agent-a",
    });
    expect(r.kind).toBe("disposition");

    const a = await readAgentRuntimeState(p.dir, "agent-a");
    expect(a?.blocked).toBe(true);

    const b = await readAgentRuntimeState(p.dir, "agent-b");
    expect(b?.blocked).not.toBe(true);

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-beforeSubmitPrompt.mjs");
    const allowB = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ prompt: "continue work", conversation_id: "agent-b" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(JSON.parse((allowB.stdout ?? "{}").trim()).continue).toBe(true);
  });

  it("I56b: RELEASE zeros repo total and clears agent blocked", async () => {
    const p = await mkGitProject("i56-release");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);

    await writeAgentRuntimeState(p.dir, "agent-x", {
      mode: "runtime",
      loop_count: 5,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: true,
      blockers: ["x"],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });

    await runStopVerifier({ status: "completed", loop_count: 0, conversation_id: "agent-x" });
    expect(await readRepoBlockedStopTotal(p.dir)).toBe(0);
    const summary = await readRepoRuntimeSummary(p.dir);
    expect(summary?.blocked_agent_count).toBe(0);
    expect((await readAgentRuntimeState(p.dir, "agent-x"))?.blocked).toBe(false);
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import {
  readAgentRuntimeState,
} from "../../src/lib/agent-runtime-state.js";
import { readAgentDisposition } from "../../src/lib/disposition.js";
import { readRepoBlockedStopTotal } from "../../src/lib/goal-loop.js";
import { recordBlockedStop, type RuntimeStateFile } from "../../src/lib/runtime-state.js";

describe("I75 same-agent loop atomicity", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    restore = undefined;
    cleanup = undefined;
  });

  it("parallel blocked stops for one conversation do not lose the per-agent loop count", async () => {
    const p = await mkGitProject("i75-agent-loop-atomicity");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);

    const state: RuntimeStateFile = {
      mode: "runtime",
      loop_count: 0,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: true,
      blockers: ["false"],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    };

    await Promise.all(
      Array.from({ length: 20 }, () => recordBlockedStop(p.dir, "agent-a", 0, state)),
    );

    expect(await readRepoBlockedStopTotal(p.dir)).toBe(20);
    expect((await readAgentRuntimeState(p.dir, "agent-a"))?.loop_count).toBe(20);
  });

  it("writes disposition from the post-lock loop count", async () => {
    const p = await mkGitProject("i75-disposition-post-lock");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const state: RuntimeStateFile = {
      mode: "runtime",
      loop_count: 0,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: true,
      blockers: ["false"],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    };

    const seen: Array<{ agentLoop: number; repoTotal: number }> = [];
    const result = await recordBlockedStop(p.dir, "agent-a", 1, state, {
      dispositionForLoop: (agentLoop, repoTotal) => {
        seen.push({ agentLoop, repoTotal });
        return {
          data: {
            status: "DISPOSITION",
            recoverable: true,
            failed: ["false"],
            loop_count: 0,
            agent_id: "agent-a",
            at: new Date().toISOString(),
          },
          mdBody: "# Disposition\n",
        };
      },
    });

    expect(result).toMatchObject({ agentLoop: 2, repoTotal: 1, dispositionWritten: true });
    expect(seen).toEqual([{ agentLoop: 2, repoTotal: 1 }]);
    expect((await readAgentDisposition(p.dir, "agent-a"))?.loop_count).toBe(2);
  });
});

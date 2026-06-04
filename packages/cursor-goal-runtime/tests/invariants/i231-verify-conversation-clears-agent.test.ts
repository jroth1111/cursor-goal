import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import {
  markUnitDoneWithEvidence,
  seedReleaseReady,
} from "../helpers/release-ready.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { readAgentRuntimeState, writeAgentRuntimeState } from "../../src/lib/agent-runtime-state.js";

describe("I231 verify --conversation clears agent handoff", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function seedReleased(
    dir: string,
    unitId: string,
    conversationId: string,
  ): Promise<void> {
    await writeFile(
      path.join(dir, "GOAL.md"),
      `## Goal
Ship

## Scope
- \`pkg/\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(dir);
    await seedReleaseReady(dir);
    await markUnitDoneWithEvidence(unitId, dir);
    const release = await runStopVerifier({
      status: "completed",
      loop_count: 0,
      conversation_id: conversationId,
    });
    expect(release.kind).toBe("release");
    expect(existsSync(path.join(dir, ".cursor/goal/passports/RELEASE.json"))).toBe(true);
  }

  it("verify --conversation clears stale blocked handoff for that agent", async () => {
    const p = await mkGitProject("i231-scoped");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const agentId = "agent-x";
    await seedReleased(p.dir, "pkg", agentId);

    await writeAgentRuntimeState(p.dir, agentId, {
      mode: "runtime",
      loop_count: 3,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: true,
      blockers: ["submit:blocked"],
      next_action: {
        kind: "dispatch_unit",
        headline: 'Dispatch work unit "pkg" (queue 1)',
        detail: "stale",
      },
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "verify", "--conversation", agentId], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);

    const state = await readAgentRuntimeState(p.dir, agentId);
    expect(state?.blocked).toBe(false);
    expect(state?.next_action).toBeNull();
  });

  it("bare verify on release clears all agent handoffs", async () => {
    const p = await mkGitProject("i231-bare");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedReleased(p.dir, "pkg", "agent-a");

    for (const id of ["agent-a", "agent-b"]) {
      await mkdir(path.join(p.dir, ".cursor/goal/agents", id), { recursive: true });
      await writeAgentRuntimeState(p.dir, id, {
        mode: "runtime",
        loop_count: 1,
        loop_limit: 40,
        phase: "VERIFY",
        blocked: true,
        blockers: ["stale"],
        next_action: {
          kind: "dispatch_unit",
          headline: "Dispatch",
          detail: "stale",
        },
        last_check_fail: null,
        updated_at: new Date().toISOString(),
      });
    }

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "verify"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);

    for (const id of ["agent-a", "agent-b"]) {
      const state = await readAgentRuntimeState(p.dir, id);
      expect(state?.blocked).toBe(false);
      expect(state?.next_action).toBeNull();
    }
  });
});

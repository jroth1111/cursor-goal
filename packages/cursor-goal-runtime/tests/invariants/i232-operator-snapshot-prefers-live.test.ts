import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { buildOperatorSnapshot } from "../../src/lib/operator.js";
import {
  markUnitDoneWithEvidence,
  seedReleaseReady,
} from "../helpers/release-ready.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { writeAgentRuntimeState } from "../../src/lib/agent-runtime-state.js";

describe("I232 operator snapshot prefers live verifier over stale submit handoff", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("status --json is unblocked when live checks pass but agent file is stale", async () => {
    const p = await mkGitProject("i232");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const agentId = "agent-stale";
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship

## Scope
- \`pkg/\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await markUnitDoneWithEvidence("pkg", p.dir);
    await runStopVerifier({
      status: "completed",
      loop_count: 0,
      conversation_id: agentId,
    });

    await writeAgentRuntimeState(p.dir, agentId, {
      mode: "runtime",
      loop_count: 4,
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

    const snap = await buildOperatorSnapshot(p.dir, { conversation_id: agentId });
    expect("error" in snap).toBe(false);
    if ("error" in snap) return;
    expect(snap.blocked).toBe(false);
    expect(snap.next_action?.kind).not.toBe("dispatch_unit");
    expect(snap.blocked_sources?.submit).toBe(true);
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(true);

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "status", "--json", "--conversation", agentId], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);
    const cliSnap = JSON.parse(r.stdout) as { blocked?: boolean; next_action?: { kind?: string } };
    expect(cliSnap.blocked).toBe(false);
    expect(cliSnap.next_action?.kind).not.toBe("dispatch_unit");
  });
});

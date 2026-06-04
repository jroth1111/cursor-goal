import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopPipeline } from "../../src/verifier/pipeline.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { writeSessionMode } from "../../src/lib/governance-config.js";
import {
  markUnitDoneWithEvidence,
  seedReleaseReady,
} from "../helpers/release-ready.js";
import { gitTreeId } from "../../src/lib/git-state.js";
import { atomicWriteJson } from "../../src/lib/paths.js";
import { readStopTraceTail } from "../../src/lib/stop-trace.js";

describe("I251 stop release authority uses full gates", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    delete process.env.CURSOR_GOAL_STOP_CHECK_PROFILE;
    restore?.();
    await cleanup?.();
  });

  it("nested stop does not release by ignoring an earlier scope blocker", async () => {
    const p = await mkGitProject("i251-nested-scope");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship scoped work

## Scope
- \`pkg/\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await mkdir(path.join(p.dir, "pkg"), { recursive: true });
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await markUnitDoneWithEvidence("pkg", p.dir);
    const first = await runStopVerifier({
      status: "completed",
      loop_count: 0,
      conversation_id: "agent-nested-scope",
    });
    expect(first.kind).toBe("release");

    await writeFile(path.join(p.dir, "outside.txt"), "out of scope\n", "utf8");
    const nested = await runStopPipeline(
      {
        status: "completed",
        loop_count: 2,
        conversation_id: "agent-nested-scope",
        stop_hook_active: true,
      },
      { dryRun: false },
    );
    expect(nested.kind).not.toBe("release");
    if (nested.kind === "continue") {
      expect(nested.message).toMatch(/Prior stop followup may be stale|scope/i);
    }
  });

  it("an existing RELEASE passport cannot bypass missing adversarial verification", async () => {
    const p = await mkGitProject("i251-passport-adversarial");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship verified unit

## Work units

### u1
Unit
- scope: \`src/\`
- verified_by: verifier
- acceptance: \`true\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await mkdir(path.join(p.dir, "src"), { recursive: true });
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await markUnitDoneWithEvidence("u1", p.dir);
    await atomicWriteJson(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"), {
      status: "RELEASE",
      at: new Date().toISOString(),
      mode: "runtime",
      loop_count: 0,
      proof_tree: gitTreeId(p.dir),
    });

    const result = await runStopVerifier({
      status: "completed",
      loop_count: 0,
      conversation_id: "agent-passport-adversarial",
      stop_hook_active: true,
    });
    expect(result.kind).not.toBe("release");
    if (result.kind === "continue") {
      expect(result.message).toMatch(/VERDICT|verify|adversarial/i);
    }
  });

  it("records stop trace after full-tier checks, not before them", async () => {
    const p = await mkGitProject("i251-full-trace");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship after full checks

## Checks
- \`[fast] true\`
- \`[full] false\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    process.env.CURSOR_GOAL_STOP_CHECK_PROFILE = "fast";

    const result = await runStopVerifier({
      status: "completed",
      loop_count: 1,
      conversation_id: "agent-full-trace",
    });
    expect(result.kind).toBe("continue");

    const [last] = await readStopTraceTail(p.dir, 1);
    expect(last.pipeline_result).toBe("continue");
    expect(last.level_failed).toBe("L3");
    expect(last.failures).toContain("false");
  });

  it("hook-stop preserves the verifier trace as the last trace when followups are disabled", async () => {
    const p = await mkGitProject("i251-last-trace");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship trace truth

## Checks
- \`false\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await writeSessionMode(p.dir, "governed", "triage");

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-stop.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        status: "completed",
        loop_count: 0,
        conversation_id: "agent-last-trace",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse((r.stdout ?? "{}").trim() || "{}")).toEqual({});

    const [last] = await readStopTraceTail(p.dir, 1);
    expect(last.pipeline_result).toBe("continue");
    expect(last.level_failed).toBe("L3");
    expect(last.failures).toContain("false");
  });

  it("does not release when compiled artifacts are missing", async () => {
    const p = await mkGitProject("i251-missing-compiled-contract");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship only from compiled contract

## Checks
- \`true\`
`,
      "utf8",
    );
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase: "VERIFY" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/discovery.json"),
      JSON.stringify({ completed: true, notes: "ok" }),
      "utf8",
    );

    const result = await runStopVerifier({
      status: "completed",
      loop_count: 0,
      conversation_id: "agent-missing-compile",
    });
    expect(result.kind).toBe("continue");
    if (result.kind === "continue") {
      expect(result.message).toMatch(/compile/i);
    }
  });

  it("does not parse malformed live GOAL.md after a valid compile", async () => {
    const p = await mkGitProject("i251-stale-live-goal");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship compiled contract

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship edited contract

## Checks
- [fast] npm test
`,
      "utf8",
    );

    const result = await runStopVerifier({
      status: "completed",
      loop_count: 0,
      conversation_id: "agent-stale-live-goal",
    });
    expect(result.kind).toBe("continue");
    if (result.kind === "continue") {
      expect(result.message).toMatch(/GOAL\.md changed after compile|cursor-goal compile/i);
      expect(result.message).not.toMatch(/backticked shell command/i);
    }
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopPipeline } from "../../src/verifier/pipeline.js";
import {
  markUnitDoneWithEvidence,
  seedReleaseReady,
} from "../helpers/release-ready.js";
import { runStopVerifier } from "../../src/lib/verify.js";

describe("I233 stop_hook_active anti-stale and release paths", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("returns idle when stop_hook_active and checks still fail", async () => {
    const p = await mkGitProject("i233-idle");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    const result = await runStopPipeline(
      { status: "completed", stop_hook_active: true },
      { dryRun: false },
    );
    expect(result.kind).toBe("idle");
  }, 20000);

  it("returns release when stop_hook_active and RELEASE passport is honored", async () => {
    const p = await mkGitProject("i233-passport");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
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
    await mkdir(path.join(p.dir, "pkg"), { recursive: true });
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await markUnitDoneWithEvidence("pkg", p.dir);
    await runStopVerifier({
      status: "completed",
      loop_count: 0,
      conversation_id: "agent-i233",
    });
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(true);

    const second = await runStopPipeline(
      {
        status: "completed",
        loop_count: 2,
        conversation_id: "agent-i233",
        stop_hook_active: true,
      },
      { dryRun: false },
    );
    expect(second.kind).toBe("release");
  }, 20000);

  it("returns release when stop_hook_active, no passport, but live checks and units pass", async () => {
    const p = await mkGitProject("i233-live");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
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
    await mkdir(path.join(p.dir, "pkg"), { recursive: true });
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await markUnitDoneWithEvidence("pkg", p.dir);

    const result = await runStopPipeline(
      {
        status: "completed",
        loop_count: 1,
        conversation_id: "agent-live",
        stop_hook_active: true,
      },
      { dryRun: false },
    );
    expect(result.kind).toBe("release");
  }, 20000);

  it("returns anti-stale continue (not dispatch) when units blocked on nested stop", async () => {
    const p = await mkGitProject("i233-stale");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
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
    await mkdir(path.join(p.dir, "pkg"), { recursive: true });
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);

    const result = await runStopPipeline(
      {
        status: "completed",
        loop_count: 2,
        stop_hook_active: true,
      },
      { dryRun: false },
    );
    expect(result.kind).toBe("continue");
    if (result.kind === "continue") {
      expect(result.message).toMatch(/Prior stop followup may be stale/i);
      expect(result.message).not.toMatch(/Dispatch work unit/i);
    }
  }, 20000);
});

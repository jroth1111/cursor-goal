import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import {
  readRepoRuntimeSummary,
  readRuntimeState,
  runtimeStatePath,
  writeRuntimeStateFile,
} from "../../src/lib/runtime-state.js";
import { readAgentRuntimeState } from "../../src/lib/agent-runtime-state.js";
import { buildOperatorSnapshot } from "../../src/lib/operator.js";
import { seedReleaseReady } from "../helpers/release-ready.js";
import { readJson } from "../../src/lib/paths.js";

describe("I55 runtime-state audit fixes", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("RELEASE zeros loop_count in runtime-state and RELEASE.json", async () => {
    const p = await mkGitProject("i55-release-loop");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);

    await writeRuntimeStateFile(p.dir, {
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

    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).toBe("release");

    const agent = await readAgentRuntimeState(p.dir, "default");
    const summary = await readRepoRuntimeSummary(p.dir);
    expect(agent?.blocked).toBe(false);
    expect(summary?.total_blocked_stops).toBe(0);

    const release = await readJson<{ loop_count?: number }>(
      path.join(p.dir, ".cursor/goal/passports/RELEASE.json"),
    );
    expect(release?.loop_count).toBe(0);
  });

  it("early continue (empty checks) clears blocked runtime-state", async () => {
    const p = await mkGitProject("i55-early-unblock");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "GOAL.md"), "## Goal\nx\n", "utf8");
    await compileGoalV2(p.dir);

    await writeRuntimeStateFile(p.dir, {
      mode: "runtime",
      loop_count: 3,
      loop_limit: 40,
      phase: "DISCOVERY",
      blocked: true,
      blockers: ["old"],
      next_action: {
        kind: "fix_checks",
        headline: "old",
        detail: "old",
      },
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });

    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).toBe("continue");
    const state = await readAgentRuntimeState(p.dir, "default");
    expect(state?.blocked).toBe(false);
    expect(state?.next_action).toBeNull();
    expect(state?.loop_count).toBe(3);
  });

  it("readRuntimeState returns null on corrupt JSON", async () => {
    const p = await mkGitProject("i55-corrupt");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(path.join(p.dir, ".cursor/goal/runtime-state.json"), "{not json", "utf8");
    expect(await readRuntimeState(p.dir)).toBeNull();
  });

  it("operator snapshot recomputes when checks pass but file still blocked", async () => {
    const p = await mkGitProject("i55-operator-fresh");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### mod-a
A
- \`pkg/a/\`
## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
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

    await writeRuntimeStateFile(p.dir, {
      mode: "runtime",
      loop_count: 2,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: true,
      blockers: ["npm test"],
      next_action: {
        kind: "fix_checks",
        headline: "Fix checks",
        detail: "run tests",
      },
      last_check_fail: null,
      updated_at: new Date(Date.now() - 60_000).toISOString(),
    });

    const snap = await buildOperatorSnapshot(p.dir);
    expect("error" in snap).toBe(false);
    if (!("error" in snap)) {
      expect(snap.blocked).toBe(true);
      expect(snap.next_action?.kind).toBe("dispatch_unit");
    }
  });

  it("disposition includes a followup message", async () => {
    const p = await mkGitProject("i55-disposition-msg");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);

    const r = await runStopVerifier({ status: "completed", loop_count: 38 });
    expect(r.kind).toBe("disposition");
    if (r.kind === "disposition") {
      expect(r.message).toMatch(/Disposition/);
      expect(r.message).toMatch(/GOAL loop/);
    }
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/DISPOSITION.json"))).toBe(true);
  });
});

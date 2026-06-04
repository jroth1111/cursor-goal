import { describe, it, expect, afterEach, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { seedReleaseReady } from "../helpers/release-ready.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { levelFreshProofBlocked } from "../../src/verifier/l6-fresh-proof.js";
import * as gitState from "../../src/lib/git-state.js";
import * as runChecks from "../../src/lib/run-checks.js";

describe("I226 stale-proof fast profile", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.CURSOR_GOAL_STOP_CHECK_PROFILE;
    restore?.();
    await cleanup?.();
  });

  it("levelFreshProof skips edits-since-last-proof when fast profile schedules zero checks", async () => {
    const p = await mkGitProject("i226-unit");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, ".cursor/goal/state.json"),
      JSON.stringify({ last_proof_tree: "proof-tree-old" }),
      "utf8",
    );
    vi.spyOn(gitState, "gitTreeId").mockReturnValue("tree-at-end");

    const ctx = {
      root: p.dir,
      input: {},
      parsed: {
        goalText: "x",
        nonGoals: [],
        checks: ["false"],
        checkTiers: { false: "full" as const },
        scope: [],
        forbiddenProxies: [],
        workUnits: [],
      },
      loopLimit: 40,
      loopCount: 2,
      failures: [] as string[],
      checkResults: [],
      currentTree: "tree-at-end",
      checkProfile: "fast" as const,
      checkTiers: { false: "full" as const },
    };

    await levelFreshProofBlocked(ctx);
    expect(ctx.failures.some((f) => f.includes("edits since last proof"))).toBe(false);
  });

  it("stop verifier does not surface edits-since-last-proof on fast profile with only full-tier checks", async () => {
    const p = await mkGitProject("i226");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Checks
- \`[full] false\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);

    await writeFile(
      path.join(p.dir, ".cursor/goal/state.json"),
      JSON.stringify({
        last_proof_tree: "proof-tree-old",
        last_edit_tree: "proof-tree-old",
      }),
      "utf8",
    );

    process.env.CURSOR_GOAL_STOP_CHECK_PROFILE = "fast";
    vi.spyOn(runChecks, "runChecks").mockResolvedValue([]);
    vi.spyOn(gitState, "gitTreeId").mockReturnValue("tree-at-end");

    const r = await runStopVerifier({ status: "completed", loop_count: 2 });
    if (r.kind === "continue") {
      expect(r.message).not.toMatch(/edits since last proof/i);
    } else {
      expect(r.kind).toBe("release");
    }
  });
});

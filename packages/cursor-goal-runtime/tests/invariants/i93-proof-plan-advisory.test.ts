import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { seedReleaseReady } from "../helpers/release-ready.js";
import { levelProofPlanAdvisory } from "../../src/verifier/l5b-proof-plan-advisory.js";
import { parseGoalMd } from "../../src/lib/parse-goal-md.js";
import { runChecks } from "../../src/lib/run-checks.js";

describe("I93 proof-plan advisory warnings", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("warns on commands outside proof-plan allowlist without blocking release", async () => {
    const p = await mkGitProject("i93");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `echo advisory-check`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeFile(
      path.join(p.dir, ".cursor/goal/proof-plan.json"),
      JSON.stringify({
        checks: ["true"],
        shell_allowlist: ["true"],
        shell_patterns: ["^true$"],
      }),
      "utf8",
    );
    await seedReleaseReady(p.dir);
    const parsed = await parseGoalMd(p.dir);
    const checkResults = await runChecks(p.dir, parsed.checks);
    const warnings = await levelProofPlanAdvisory({
      root: p.dir,
      input: { status: "completed" },
      parsed,
      loopLimit: 40,
      loopCount: 0,
      failures: [],
      checkResults,
      currentTree: "tree",
    });
    expect(warnings.some((w) => w.includes("proof-plan"))).toBe(true);
    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).toBe("release");
  });
});

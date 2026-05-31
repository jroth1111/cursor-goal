import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopPipeline } from "../../src/verifier/pipeline.js";
import { readTrajectory } from "../../src/trajectory/fsm.js";
import { writePassingUnitEvidence } from "../helpers/release-ready.js";

describe("I157 dry-run auto-advance", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("simulates completed-unit auto-advance without mutating trajectory.json", async () => {
    const p = await mkGitProject("i157-dry-run-auto-advance");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, "src"), { recursive: true });
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship dry-run proof.

## Work units

### unit-a
Unit A
- scope: \`src/\`
- acceptance: \`true\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeFile(
      path.join(p.dir, ".cursor/goal/discovery.json"),
      JSON.stringify({ completed: true, notes: "ok" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase: "IMPLEMENT" }),
      "utf8",
    );
    const wuPath = path.join(p.dir, ".cursor/goal/work-units.json");
    const wu = JSON.parse(await readFile(wuPath, "utf8"));
    wu.units[0].status = "done";
    await writeFile(wuPath, JSON.stringify(wu, null, 2), "utf8");
    await writePassingUnitEvidence(p.dir, "unit-a");

    const result = await runStopPipeline({ status: "completed", loop_count: 0 }, { dryRun: true });

    expect(result.kind).toBe("release");
    expect((await readTrajectory(p.dir)).phase).toBe("IMPLEMENT");
  });
});

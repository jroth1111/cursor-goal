import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { readTrajectory } from "../../src/trajectory/fsm.js";
import { markUnitDoneWithEvidence } from "../helpers/release-ready.js";

describe("I30 auto VERIFY phase", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("advances IMPLEMENT to VERIFY when all units done before stop", async () => {
    const p = await mkGitProject("i30");
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
      JSON.stringify({ phase: "IMPLEMENT" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/discovery.json"),
      JSON.stringify({ completed: true, notes: "ok" }),
      "utf8",
    );
    await markUnitDoneWithEvidence("mod-a", p.dir);

    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).toBe("release");
    const traj = await readTrajectory(p.dir);
    expect(traj.phase).toBe("VERIFY");
  });
});

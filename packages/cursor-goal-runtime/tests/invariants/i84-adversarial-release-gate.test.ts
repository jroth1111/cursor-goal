import { describe, it, expect, afterEach } from "vitest";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { seedReleaseReady } from "../helpers/release-ready.js";
import { recordVerifierResponse } from "../../src/lib/dispatch-verify.js";

describe("I84 adversarial release gate", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("allows RELEASE when deliverable and VERDICT PASS recorded", async () => {
    const p = await mkGitProject("i84");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship

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
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    const deliverable = path.join(p.dir, ".cursor/goal/outputs/u1/deliverable.md");
    await mkdir(path.dirname(deliverable), { recursive: true });
    await writeFile(deliverable, "# Done\n", "utf8");
    const wuPath = path.join(p.dir, ".cursor/goal/work-units.json");
    const wu = JSON.parse(await readFile(wuPath, "utf8"));
    wu.units[0].status = "done";
    await writeFile(wuPath, JSON.stringify(wu, null, 2), "utf8");
    await recordVerifierResponse(p.dir, "u1", "VERDICT: PASS");

    const fin = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(fin.kind).toBe("release");
  });
});

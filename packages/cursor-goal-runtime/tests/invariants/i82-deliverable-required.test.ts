import { describe, it, expect, afterEach } from "vitest";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { seedReleaseReady } from "../helpers/release-ready.js";

describe("I82 deliverable required for verified_by units", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("blocks RELEASE without deliverable and verifier PASS", async () => {
    const p = await mkGitProject("i82");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship auth

## Work units

### auth
Auth work
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
    const wuPath = path.join(p.dir, ".cursor/goal/work-units.json");
    const wu = JSON.parse(await readFile(wuPath, "utf8"));
    wu.units[0].status = "done";
    await writeFile(wuPath, JSON.stringify(wu, null, 2), "utf8");
    await mkdir(path.join(p.dir, "src"), { recursive: true });

    const fin = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(fin.kind).not.toBe("release");
  });
});

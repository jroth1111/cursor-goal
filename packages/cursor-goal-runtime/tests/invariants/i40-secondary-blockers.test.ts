import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { seedReleaseReady } from "../helpers/release-ready.js";

describe("I40 followup lists secondary blockers", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("stop followup includes Also blocked when multiple blockers exist", async () => {
    const p = await mkGitProject("i40");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship modules

## Work units

### mod-a
Module A
- \`pkg/a/\`

## Checks
- \`false\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);

    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).toBe("continue");
    if (r.kind === "continue") {
      expect(r.message).toMatch(/Also blocked/);
      expect(r.message).toMatch(/Next action \(do this first\)/);
    }
  });
});

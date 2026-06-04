import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { rankNextAction } from "../../src/lib/next-action.js";
import { readWorkUnits } from "../../src/lib/work-units.js";
import { seedReleaseReady } from "../helpers/release-ready.js";
import type { VerifierContext } from "../../src/verifier/types.js";

describe("I222 unit role implement|verify", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("compiles role and verify role prefers verify path even when acceptance fails", async () => {
    const p = await mkGitProject("i222");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### audit-me
Audit only
- scope: \`pkg/\`
- role: verify
- acceptance: \`false\`
## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    const wu = await readWorkUnits(p.dir);
    expect(wu?.units[0]?.role).toBe("verify");

    await seedReleaseReady(p.dir);
    const ctx: VerifierContext = {
      root: p.dir,
      input: {},
      parsed: {
        goalText: "x",
        scope: ["pkg/"],
        checks: ["true"],
        checkTiers: {},
        nonGoals: [],
        forbiddenProxies: [],
        workUnits: [],
      },
      loopLimit: 40,
      loopCount: 0,
      failures: [],
      checkResults: [],
      currentTree: "t",
      phaseBlocked: false,
      unitsBlocked: true,
      phase: "IMPLEMENT",
    };
    const action = await rankNextAction({
      ctx,
      unitsBlocked: true,
      phaseBlocked: false,
    });
    expect(action?.kind).toBe("verify_unit");
    expect(action?.headline).toMatch(/fix acceptance or artifacts/i);
  });
});

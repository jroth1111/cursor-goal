import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { rankNextAction } from "../../src/lib/next-action.js";
import { seedReleaseReady } from "../helpers/release-ready.js";
import type { VerifierContext } from "../../src/verifier/types.js";

describe("I219 verify-first dispatch", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("prefers verify path when unit acceptance already passes", async () => {
    const p = await mkGitProject("i219");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, "pkg"), { recursive: true });
    await writeFile(path.join(p.dir, "pkg", "ok.txt"), "ok\n", "utf8");
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship pkg

## Scope
- \`pkg/\`

## Work units
### pkg-unit
Verify pkg

- scope: \`pkg/\`
- acceptance: \`test -f pkg/ok.txt\`
- verified_by: verifier

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);

    const ctx: VerifierContext = {
      root: p.dir,
      input: { status: "completed", loop_count: 0 },
      parsed: {
        goalText: "Ship pkg",
        scope: ["pkg/"],
        checks: ["true"],
        checkTiers: { true: "full" },
        nonGoals: [],
        forbiddenProxies: [],
        workUnits: [],
      },
      loopLimit: 40,
      loopCount: 0,
      failures: [],
      checkResults: [],
      currentTree: "tree",
      phaseBlocked: false,
      unitsBlocked: true,
      phase: "IMPLEMENT",
    };

    const action = await rankNextAction({
      ctx,
      phase: "IMPLEMENT",
      phaseBlocked: false,
      unitsBlocked: true,
    });
    expect(action?.kind).toBe("verify_unit");
    expect(action?.headline).toMatch(/acceptance already passes/i);
    const formatted = [
      action?.headline,
      action?.detail,
      action?.taskPrompt ?? "",
    ].join("\n");
    expect(formatted).not.toMatch(/Spawn one Task/i);
    expect(formatted).toMatch(/dispatch --verify --unit pkg-unit/);
  });
});

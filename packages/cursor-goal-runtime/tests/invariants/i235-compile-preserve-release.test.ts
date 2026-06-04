import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { honorExistingReleasePassport } from "../../src/lib/runtime-state.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import {
  markUnitDoneWithEvidence,
  seedReleaseReady,
} from "../helpers/release-ready.js";

describe("I235 compile preserves RELEASE on immaterial GOAL recompile", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  const goalBody = `## Goal
Ship v1

## Scope
- \`pkg/\`

## Checks
- \`true\`
`;

  async function releaseProject(dir: string): Promise<void> {
    await compileGoalV2(dir);
    await seedReleaseReady(dir);
    await markUnitDoneWithEvidence("pkg", dir);
    const r = await runStopVerifier({
      status: "completed",
      loop_count: 0,
      conversation_id: "agent-i235",
    });
    expect(r.kind).toBe("release");
  }

  it("keeps RELEASE.json when GOAL text is unchanged on recompile", async () => {
    const p = await mkGitProject("i235-keep");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "GOAL.md"), goalBody, "utf8");
    await releaseProject(p.dir);
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(true);

    await compileGoalV2(p.dir);
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(true);
    expect(await honorExistingReleasePassport(p.dir)).toBe(true);
  });

  it("removes RELEASE.json when GOAL goal text changes materially", async () => {
    const p = await mkGitProject("i235-drop");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "GOAL.md"), goalBody, "utf8");
    await releaseProject(p.dir);

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      goalBody.replace("Ship v1", "Ship v2"),
      "utf8",
    );
    await compileGoalV2(p.dir);
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(false);
  });

  it("removes RELEASE when a new work unit is added to GOAL", async () => {
    const p = await mkGitProject("i235-unit");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "GOAL.md"), goalBody, "utf8");
    await releaseProject(p.dir);

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `${goalBody}
## Work units

### extra
Extra unit
- \`pkg/extra/\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(false);
  });
});

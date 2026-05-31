import { describe, it, expect, afterEach } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";

describe("I166 compile recovers malformed generated state artifacts", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  it("rebuilds manifest.json and trajectory.json when existing generated artifacts are malformed", async () => {
    const p = await mkGitProject("i166-compile-recovers-generated-state");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);

    const goalDir = path.join(p.dir, ".cursor/goal");
    await writeFile(path.join(goalDir, "manifest.json"), "{", "utf8");
    await writeFile(path.join(goalDir, "trajectory.json"), "{", "utf8");

    await compileGoalV2(p.dir);

    const manifest = JSON.parse(await readFile(path.join(goalDir, "manifest.json"), "utf8")) as {
      runtime?: string;
      loop_limit?: number;
    };
    const trajectory = JSON.parse(
      await readFile(path.join(goalDir, "trajectory.json"), "utf8"),
    ) as { phase?: string };
    expect(manifest.runtime).toBe("package");
    expect(manifest.loop_limit).toBe(40);
    expect(trajectory.phase).toBe("DISCOVERY");
  });
});

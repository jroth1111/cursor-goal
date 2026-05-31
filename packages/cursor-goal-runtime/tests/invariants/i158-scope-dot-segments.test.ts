import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { markUnitDone } from "../../src/lib/work-units.js";
import { seedReleaseReady } from "../helpers/release-ready.js";

describe("I158 scope dot-segment normalization", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("normalizes dot-segment GOAL scopes before L4 enforcement", async () => {
    const p = await mkGitProject("i158-scope-dot-segments");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, "allowed"), { recursive: true });
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Scope
- \`src/../allowed/\`
## Work units
### unit-a
Allowed unit
- scope: \`src/../allowed/\`
- acceptance: \`true\`
## Checks
- \`true\`
`,
      "utf8",
    );

    await compileGoalV2(p.dir);
    await markUnitDone("unit-a", p.dir);
    await seedReleaseReady(p.dir);
    await writeFile(path.join(p.dir, "allowed/file.ts"), "export const ok = true;\n", "utf8");

    const result = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(result.kind).toBe("release");

    const scope = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/scope.json"), "utf8"),
    );
    expect(scope.paths).toEqual(["allowed/"]);

    const workUnits = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/work-units.json"), "utf8"),
    );
    expect(workUnits.units[0].scope).toEqual(["allowed/"]);
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";

describe("I164 compile recovers generated work-unit artifacts", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  it("rebuilds work-units.json when the existing generated artifact is malformed", async () => {
    const p = await mkGitProject("i164-compile-recovers-work-units");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x

## Work units

### unit-a
A
- \`src/\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);

    const workUnits = path.join(p.dir, ".cursor/goal/work-units.json");
    await writeFile(workUnits, "{", "utf8");

    await compileGoalV2(p.dir);

    const parsed = JSON.parse(await readFile(workUnits, "utf8")) as {
      units?: Array<{ id?: string; status?: string }>;
    };
    expect(parsed.units?.map((u) => u.id)).toEqual(["unit-a"]);
    expect(parsed.units?.[0]?.status).toBe("pending");
  });
});

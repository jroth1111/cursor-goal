import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { markUnitInProgress } from "../../src/lib/work-units.js";

describe("I18 one in_progress subagent per unit", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("denies second subagent on same unit", async () => {
    const p = await mkGitProject("i18");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### unit-a
Task A
- \`src/a/\`
## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    expect(await markUnitInProgress("unit-a", "sub-1", p.dir)).toBe(true);
    expect(await markUnitInProgress("unit-a", "sub-2", p.dir)).toBe(false);
    const { readWorkUnits } = await import("../../src/lib/work-units.js");
    const wu = await readWorkUnits(p.dir);
    const unit = wu?.units.find((u) => u.id === "unit-a");
    expect(unit?.status).toBe("in_progress");
    expect(unit?.subagent_id).toBe("sub-1");
  });
});

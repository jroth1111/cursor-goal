import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";

describe("I98 unique work unit ids", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("rejects work units whose headings compile to the same id", async () => {
    const p = await mkGitProject("i98-duplicate-units");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### mod-a
First unit
- acceptance: \`true\`
### mod a
Second unit
- acceptance: \`true\`
## Checks
- \`true\`
`,
      "utf8",
    );

    await expect(compileGoalV2(p.dir)).rejects.toThrow(/duplicate work unit id "mod-a"/i);
  });
});

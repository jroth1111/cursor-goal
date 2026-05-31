import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";

describe("I151 invalid explicit work unit ids", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("rejects explicit work unit headings that cannot become valid ids", async () => {
    const p = await mkGitProject("i151-invalid-unit-id");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, "src"), { recursive: true });
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Scope
- \`src/\`
## Work units
### !!!
Invalid explicit unit
- scope: \`src/\`
- acceptance: \`true\`
## Checks
- \`true\`
`,
      "utf8",
    );

    await expect(compileGoalV2(p.dir)).rejects.toThrow(/Compile validation failed|work-units/i);
    expect(existsSync(path.join(p.dir, ".cursor/goal/work-units.json"))).toBe(false);
  });
});

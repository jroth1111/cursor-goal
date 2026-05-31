import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { lintGoalMd } from "../../src/lib/goal-lint.js";

describe("I79 goal lint", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("warns on template placeholder and npm checks without package.json", async () => {
    const p = await mkGitProject("i79");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Describe the user-visible outcome in one paragraph.
## Checks
- \`npm test\`
`,
      "utf8",
    );
    const issues = await lintGoalMd(p.dir);
    expect(issues.some((i) => i.message.includes("placeholder"))).toBe(true);
    expect(issues.some((i) => i.level === "error" && i.message.includes("package.json"))).toBe(true);
  });
});

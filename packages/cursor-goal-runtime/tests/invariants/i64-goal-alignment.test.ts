import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { auditGoalAlignment } from "../../src/lib/goal-alignment.js";
import { runDoctor } from "../../src/lib/doctor.js";

const templateGoal = `# Goal

## Goal

Describe the user-visible outcome in one paragraph.

## Non-goals

- Item the agent must not do

## Scope

- \`src/\`

## Work units

### auth-middleware

Add auth middleware

- scope: \`src/auth/\`
- acceptance: \`npm test -- src/auth\`

## Checks

- \`npm test\`
- \`npm run lint\`
`;

describe("I64 GOAL/repo alignment audit", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("detects template GOAL and npm checks that do not match a Python repo", async () => {
    const p = await mkGitProject("i64-audit");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "GOAL.md"), templateGoal, "utf8");
    await writeFile(path.join(p.dir, "pyproject.toml"), "[project]\nname = \"demo\"\n", "utf8");

    const issues = await auditGoalAlignment(p.dir);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: "warn", message: expect.stringMatching(/template placeholder/i) }),
        expect.objectContaining({ level: "error", message: expect.stringMatching(/no package\.json/i) }),
        expect.objectContaining({ level: "warn", message: expect.stringMatching(/Python project/i) }),
        expect.objectContaining({ level: "warn", message: expect.stringMatching(/scope "src\/auth\/"/i) }),
        expect.objectContaining({ level: "warn", message: expect.stringMatching(/auth-middleware/i) }),
      ]),
    );
  });

  it("compile fails on alignment errors instead of emitting bad artifacts", async () => {
    const p = await mkGitProject("i64-compile");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "GOAL.md"), templateGoal, "utf8");

    await expect(compileGoalV2(p.dir)).rejects.toThrow(/GOAL alignment failed|no package\.json/i);
  });

  it("doctor reports GOAL alignment warnings and errors", async () => {
    const p = await mkGitProject("i64-doctor");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "GOAL.md"), templateGoal, "utf8");

    const issues = await runDoctor(p.dir);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: "error", message: expect.stringMatching(/no package\.json/i) }),
        expect.objectContaining({ level: "warn", message: expect.stringMatching(/template placeholder/i) }),
      ]),
    );
  });
});

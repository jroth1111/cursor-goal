import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { validateArtifact } from "../../src/compile/schemas.js";

describe("I13 schema-valid compile", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("compile emits schema-valid work-units and claim", async () => {
    const p = await mkGitProject("i13");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship feature X

## Scope
- \`src/a/\`
- \`src/b/\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    const { readFile } = await import("node:fs/promises");
    const wu = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/work-units.json"), "utf8"),
    );
    const claim = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/claim.json"), "utf8"),
    );
    expect((await validateArtifact("work-units", wu)).ok).toBe(true);
    expect((await validateArtifact("claim", claim)).ok).toBe(true);
    expect(wu.units.length).toBe(2);
  });
});

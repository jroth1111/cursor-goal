import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";

describe("I150 work unit markdown noise", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("ignores prose and HTML-commented examples before real work unit headings", async () => {
    const p = await mkGitProject("i150-work-unit-noise");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, "src/live"), { recursive: true });
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Scope
- \`src/\`
## Work units
Optional. When omitted, one unit is created per Scope path.

<!--
Example unit (uncomment and edit):

### commented-example
Short title
- scope: \`src/commented/\`
- acceptance: \`false\`
-->

### live
Live unit
- scope: \`src/live/\`
- acceptance: \`true\`
## Checks
- \`true\`
`,
      "utf8",
    );

    await compileGoalV2(p.dir);
    const workUnits = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/work-units.json"), "utf8"),
    );
    expect(workUnits.units.map((unit: { id: string }) => unit.id)).toEqual(["live"]);
    expect(workUnits.units[0].scope).toEqual(["src/live/"]);
  });

  it("auto-slices scope when the work units section contains only template prose", async () => {
    const p = await mkGitProject("i150-template-prose");
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
Optional. When omitted, one unit is created per Scope path.

<!--
Example unit (uncomment and edit):

### example-unit
Short title
- scope: \`src/example/\`
- acceptance: \`false\`
-->
## Checks
- \`true\`
`,
      "utf8",
    );

    await compileGoalV2(p.dir);
    const workUnits = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/work-units.json"), "utf8"),
    );
    expect(workUnits.units.map((unit: { id: string }) => unit.id)).toEqual(["src"]);
    expect(workUnits.units[0].scope).toEqual(["src/"]);
  });
});

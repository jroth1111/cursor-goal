import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { shouldAutoDispatchUnits } from "../../../../supervisor/run-goal.mjs";

describe("I37 supervisor auto-dispatch for open units", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function seedTwoUnits(p: { dir: string }): Promise<void> {
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship modules

## Work units

### mod-a
Module A
- \`pkg/a/\`

### mod-b
Module B
- \`pkg/b/\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
  }

  it("shouldAutoDispatchUnits is true for single open unit", async () => {
    const p = await mkGitProject("i37-one");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### mod-a
A
- \`pkg/a/\`
## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    expect(await shouldAutoDispatchUnits(p.dir, { dispatchUnits: false, parentOnly: false })).toBe(
      true,
    );
  });

  it("shouldAutoDispatchUnits is true for 2+ units without flags", async () => {
    const p = await mkGitProject("i37");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedTwoUnits(p);

    expect(await shouldAutoDispatchUnits(p.dir, { dispatchUnits: false, parentOnly: false })).toBe(
      true,
    );
    expect(await shouldAutoDispatchUnits(p.dir, { dispatchUnits: false, parentOnly: true })).toBe(
      false,
    );
  });

  it("dry-run dispatches queue order without --dispatch-units", async () => {
    const p = await mkGitProject("i37b");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedTwoUnits(p);

    const installSh = path.resolve(import.meta.dirname, "../../../../core/install.sh");
    spawnSync("bash", [installSh, p.dir], { encoding: "utf8" });

    const supervisor = path.resolve(import.meta.dirname, "../../../../supervisor/run-goal.mjs");
    const r = spawnSync("node", [supervisor, "--dry-run"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);
    const out = `${r.stdout}\n${r.stderr}`;
    expect(out).toMatch(/Dispatch unit: mod-a/);
    expect(out).toMatch(/Dispatch unit: mod-b/);
    expect(out.indexOf("mod-a")).toBeLessThan(out.indexOf("mod-b"));
  });
});

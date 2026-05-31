import { describe, it, expect, afterEach } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { formatDispatchVerifyCli } from "../../src/lib/dispatch-verify.js";

describe("I85 dispatch verify CLI", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("prints verification prompt including deliverable", async () => {
    const p = await mkGitProject("i85");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x

## Work units

### u1
Unit
- scope: \`src/\`
- verified_by: verifier

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    const deliverable = path.join(p.dir, ".cursor/goal/outputs/u1/deliverable.md");
    await mkdir(path.dirname(deliverable), { recursive: true });
    await writeFile(deliverable, "summary\n", "utf8");
    const text = await formatDispatchVerifyCli(p.dir, "u1");
    expect(text).toMatch(/Adversarial verification/);
    expect(text).toMatch(/summary/);
  });

  it("rejects explicit units without verified_by", async () => {
    const p = await mkGitProject("i85-no-verified-by");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x

## Work units

### u1
Unit
- scope: \`src/\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    const deliverable = path.join(p.dir, ".cursor/goal/outputs/u1/deliverable.md");
    await mkdir(path.dirname(deliverable), { recursive: true });
    await writeFile(deliverable, "summary\n", "utf8");

    const text = await formatDispatchVerifyCli(p.dir, "u1");

    expect(text).toMatch(/Unknown unit or unit has no verified_by: u1/);
    expect(text).not.toMatch(/Adversarial verification/);
  });
});

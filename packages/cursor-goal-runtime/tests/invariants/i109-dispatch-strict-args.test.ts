import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { unitVerifierResultPath } from "../../src/lib/adversarial-paths.js";

describe("I109 dispatch strict args", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function seedVerifiedUnit(p: { dir: string }): Promise<void> {
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
  }

  it("rejects --unit without a value before selecting a verifier prompt", async () => {
    const p = await mkGitProject("i109-unit");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedVerifiedUnit(p);

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "dispatch", "--verify", "--unit"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Missing value for --unit/);
    expect(r.stdout).not.toMatch(/Adversarial verification/);
  });

  it("rejects incomplete --record-response arguments before writing verifier state", async () => {
    const p = await mkGitProject("i109-record");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedVerifiedUnit(p);

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "dispatch", "--record-response", "u1"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/requires --from <file>/);
    expect(existsSync(unitVerifierResultPath(p.dir, "u1"))).toBe(false);
  });
});

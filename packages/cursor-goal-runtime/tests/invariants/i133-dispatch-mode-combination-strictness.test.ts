import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";

describe("I133 dispatch mode combination strictness", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function seedVerifiedUnit(dir: string): Promise<void> {
    await writeFile(
      path.join(dir, "GOAL.md"),
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
    await compileGoalV2(dir);
    const deliverable = path.join(dir, ".cursor/goal/outputs/u1/deliverable.md");
    await mkdir(path.dirname(deliverable), { recursive: true });
    await writeFile(deliverable, "summary\n", "utf8");
  }

  it("rejects dispatch mode combinations that would ignore one selected mode", async () => {
    const p = await mkGitProject("i133-dispatch-combos");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedVerifiedUnit(p.dir);
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");

    const cases = [
      {
        args: ["dispatch", "--verify", "--dry-run"],
        error: /dispatch --dry-run with --verify requires --spawn/,
      },
      {
        args: ["dispatch", "--verify", "--run"],
        error: /dispatch --run cannot be combined with --verify/,
      },
    ];

    for (const c of cases) {
      const r = spawnSync("node", [cli, ...c.args], {
        cwd: p.dir,
        encoding: "utf8",
        env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
      });

      expect(r.status, c.args.join(" ")).not.toBe(0);
      expect(r.stderr, c.args.join(" ")).toMatch(c.error);
      expect(r.stdout, c.args.join(" ")).not.toMatch(/Adversarial verification|Would run:/);
    }
  });
});

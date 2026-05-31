import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { unitVerifierResultPath } from "../../src/lib/adversarial-paths.js";

describe("I134 dispatch value option occurrence strictness", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function seedVerifiedUnit(dir: string): Promise<string> {
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
    const responsePath = path.join(dir, "verifier-response.txt");
    await writeFile(responsePath, "VERDICT: PASS\n", "utf8");
    return responsePath;
  }

  it("rejects every missing dispatch value occurrence before executing the selected action", async () => {
    const p = await mkGitProject("i134-dispatch-value-occurrences");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const responsePath = await seedVerifiedUnit(p.dir);
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");

    const cases = [
      {
        args: ["dispatch", "--verify", "--unit", "u1", "--unit"],
        error: /Missing value for --unit/,
      },
      {
        args: ["dispatch", "--record-response", "u1", "--from", responsePath, "--from"],
        error: /Missing value for --from/,
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
      expect(r.stdout, c.args.join(" ")).not.toMatch(/Adversarial verification|VERDICT/);
      expect(existsSync(unitVerifierResultPath(p.dir, "u1"))).toBe(false);
    }
  });
});

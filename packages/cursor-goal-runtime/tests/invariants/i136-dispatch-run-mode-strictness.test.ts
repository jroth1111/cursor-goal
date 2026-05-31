import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";

describe("I136 dispatch run mode strictness", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("rejects conflicting dispatch run modes before selecting dry-run behavior", async () => {
    const p = await mkGitProject("i136-dispatch-run-mode");
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

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "dispatch", "--dry-run", "--run"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/dispatch --dry-run cannot be combined with --run/);
    expect(r.stdout).not.toMatch(/Would dispatch|Spawn one Task|cursor-agent/);
  });
});

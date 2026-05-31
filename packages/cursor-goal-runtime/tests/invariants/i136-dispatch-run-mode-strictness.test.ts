import { describe, it, expect, afterEach } from "vitest";
import { cp, mkdir, symlink, writeFile } from "node:fs/promises";
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

  it("resolves supervisor from the install manifest when dispatch runs from global runtime", async () => {
    const p = await mkGitProject("i136-global-dispatch-run");
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

    const fakeHome = path.join(p.dir, "home");
    const cursorHome = path.join(p.dir, "cursor-home");
    const globalRuntime = path.join(cursorHome, "cursor-goal-runtime");
    await mkdir(path.join(cursorHome, "cursor-goal"), { recursive: true });
    await cp(path.resolve(import.meta.dirname, "../../dist"), path.join(globalRuntime, "dist"), {
      recursive: true,
    });
    await writeFile(path.join(globalRuntime, "package.json"), '{"type":"module"}\n', "utf8");
    await symlink(
      path.resolve(import.meta.dirname, "../../../../node_modules"),
      path.join(globalRuntime, "node_modules"),
      "dir",
    );
    await writeFile(
      path.join(cursorHome, "cursor-goal/install-manifest.json"),
      JSON.stringify(
        {
          source: path.resolve(import.meta.dirname, "../../../.."),
          runtime: globalRuntime,
        },
        null,
        2,
      ),
      "utf8",
    );

    const installSh = path.resolve(import.meta.dirname, "../../../../core/install.sh");
    const install = spawnSync("bash", [installSh, "--local-hooks"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, HOME: fakeHome, CURSOR_HOME: cursorHome },
    });
    expect(install.status, install.stderr || install.stdout).toBe(0);

    const cli = path.join(globalRuntime, "dist/cli.js");
    const r = spawnSync("node", [cli, "dispatch", "--dry-run"], {
      cwd: p.dir,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: fakeHome,
        CURSOR_HOME: cursorHome,
        CURSOR_GOAL_RUNTIME: globalRuntime,
        CURSOR_PROJECT_DIR: p.dir,
      },
    });

    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/Dispatch unit: mod-a/);
    expect(r.stdout).toMatch(/Would run:/);
    expect(r.stderr).not.toMatch(/Cannot find module/);
  });
});

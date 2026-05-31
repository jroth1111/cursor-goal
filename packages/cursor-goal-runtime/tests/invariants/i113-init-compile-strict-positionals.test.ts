import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I113 init and compile strict positional args", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("rejects unexpected init positional args before creating GOAL.md", async () => {
    const p = await mkGitProject("i113-init");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "init", "GOAL.md"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unexpected argument: GOAL\.md/);
    expect(existsSync(path.join(p.dir, "GOAL.md"))).toBe(false);
  });

  it("rejects unexpected compile positional args before writing compiled artifacts", async () => {
    const p = await mkGitProject("i113-compile");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nShip strict compile parsing\n\n## Checks\n- `true`\n",
      "utf8",
    );

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "compile", "GOAL.md"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unexpected argument: GOAL\.md/);
    expect(existsSync(path.join(p.dir, ".cursor/goal/manifest.json"))).toBe(false);
  });
});

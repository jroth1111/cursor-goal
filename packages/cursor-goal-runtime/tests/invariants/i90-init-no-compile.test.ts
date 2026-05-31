import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { existsSync } from "node:fs";

describe("I90 init without compile", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("succeeds in blank git repo without compiling", async () => {
    const p = await mkGitProject("i90");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "init"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);
    expect(existsSync(path.join(p.dir, "GOAL.md"))).toBe(true);
    expect(existsSync(path.join(p.dir, ".cursor/goal/manifest.json"))).toBe(false);
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I110 operator mutator strict args", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("rejects unknown pause args before writing PAUSED", async () => {
    const p = await mkGitProject("i110-pause");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "pause", "--paus"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unknown option: --paus/);
    expect(existsSync(path.join(p.dir, ".cursor/goal/PAUSED"))).toBe(false);
  });

  it("rejects extra mode args before writing session mode or seeding GOAL.md", async () => {
    const p = await mkGitProject("i110-mode");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "mode", "governed", "--governd"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Usage: cursor-goal mode/);
    expect(existsSync(path.join(p.dir, ".cursor/goal/session-mode.json"))).toBe(false);
    expect(existsSync(path.join(p.dir, "GOAL.md"))).toBe(false);
  });
});

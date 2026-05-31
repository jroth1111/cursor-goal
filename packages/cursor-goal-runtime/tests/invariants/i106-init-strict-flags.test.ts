import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I106 init strict flags", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("rejects unknown init flags before creating GOAL.md", async () => {
    const p = await mkGitProject("i106");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "init", "--compiel"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unknown option: --compiel/);
    expect(existsSync(path.join(p.dir, "GOAL.md"))).toBe(false);
    expect(existsSync(path.join(p.dir, ".cursor/goal/manifest.json"))).toBe(false);
  });
});

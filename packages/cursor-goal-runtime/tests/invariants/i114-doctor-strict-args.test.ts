import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I114 doctor strict args", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("rejects unsupported doctor args before applying fixes", async () => {
    const p = await mkGitProject("i114-doctor");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const stale = path.join(p.dir, ".cursor/goal/NEXT_UNIT.md");
    await writeFile(stale, "old next unit\n", "utf8");

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "doctor", "--fix", "--fxi"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unknown option: --fxi/);
    expect(existsSync(stale)).toBe(true);
  });
});

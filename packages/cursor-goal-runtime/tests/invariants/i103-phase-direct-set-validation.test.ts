import { describe, it, expect, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I103 phase direct-set validation", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("rejects unknown direct-set phases without writing trajectory.json", async () => {
    const p = await mkGitProject("i103");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "phase", "SHIPIT"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Invalid phase: SHIPIT/);
    expect(existsSync(path.join(p.dir, ".cursor/goal/trajectory.json"))).toBe(false);
  });

  it("still allows valid direct-set phases", async () => {
    const p = await mkGitProject("i103-valid");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "phase", "VERIFY"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).toBe(0);
    const trajectory = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/trajectory.json"), "utf8"),
    ) as { phase?: string };
    expect(trajectory.phase).toBe("VERIFY");
  });
});

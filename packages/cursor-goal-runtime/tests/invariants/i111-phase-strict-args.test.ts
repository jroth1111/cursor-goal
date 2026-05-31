import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I111 phase strict args", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("rejects extra direct-set phase args before writing trajectory.json", async () => {
    const p = await mkGitProject("i111-direct");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "phase", "VERIFY", "--verfy"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unexpected argument: --verfy|Unknown option: --verfy/);
    expect(existsSync(path.join(p.dir, ".cursor/goal/trajectory.json"))).toBe(false);
  });

  it("rejects extra advance args before mutating an existing trajectory", async () => {
    const p = await mkGitProject("i111-advance");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase: "IMPLEMENT" }),
      "utf8",
    );

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "phase", "advance", "VERIFY", "--verfy"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unexpected argument: --verfy|Unknown option: --verfy/);
    const trajectory = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/trajectory.json"), "utf8"),
    ) as { phase?: string };
    expect(trajectory.phase).toBe("IMPLEMENT");
  });
});

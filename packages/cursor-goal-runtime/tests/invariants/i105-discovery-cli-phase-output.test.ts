import { describe, it, expect, afterEach } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I105 discovery CLI phase output", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function writePhase(dir: string, phase: string): Promise<void> {
    await writeFile(
      path.join(dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase }),
      "utf8",
    );
  }

  async function readPhase(dir: string): Promise<string | undefined> {
    const trajectory = JSON.parse(
      await readFile(path.join(dir, ".cursor/goal/trajectory.json"), "utf8"),
    ) as { phase?: string };
    return trajectory.phase;
  }

  it("does not claim advancement when discovery completion leaves PLAN unchanged", async () => {
    const p = await mkGitProject("i105-plan");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writePhase(p.dir, "PLAN");

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "discovery", "complete", "notes"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/phase remains PLAN/);
    expect(r.stdout).not.toMatch(/advanced to IMPLEMENT/);
    expect(await readPhase(p.dir)).toBe("PLAN");
  });

  it("still reports advancement from DISCOVERY to IMPLEMENT", async () => {
    const p = await mkGitProject("i105-discovery");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writePhase(p.dir, "DISCOVERY");

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "discovery", "complete", "notes"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/phase advanced to IMPLEMENT/);
    expect(await readPhase(p.dir)).toBe("IMPLEMENT");
  });
});

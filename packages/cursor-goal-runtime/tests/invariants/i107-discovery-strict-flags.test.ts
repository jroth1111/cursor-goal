import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I107 discovery strict flags", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function readPhase(dir: string): Promise<string | undefined> {
    const trajectory = JSON.parse(
      await readFile(path.join(dir, ".cursor/goal/trajectory.json"), "utf8"),
    ) as { phase?: string };
    return trajectory.phase;
  }

  it("rejects unknown discovery complete flags before writing phase state", async () => {
    const p = await mkGitProject("i107");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase: "DISCOVERY" }),
      "utf8",
    );

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "discovery", "complete", "--plna-only", "notes"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unknown option: --plna-only/);
    expect(existsSync(path.join(p.dir, ".cursor/goal/discovery.json"))).toBe(false);
    expect(await readPhase(p.dir)).toBe("DISCOVERY");
  });
});

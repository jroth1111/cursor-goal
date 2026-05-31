import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

describe("I102 pause command fresh repo", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("creates the goal directory before writing PAUSED", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "i102-pause-"));
    execSync("git init -q", { cwd: dir });

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "pause"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: dir },
    });

    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Paused/);
    expect(existsSync(path.join(dir, ".cursor/goal/PAUSED"))).toBe(true);
  });
});

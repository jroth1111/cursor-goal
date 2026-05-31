import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I96 core install flag parsing", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("treats --local-hooks as a flag, not the destination path", async () => {
    const p = await mkGitProject("i96-local-hooks");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const installSh = path.resolve(import.meta.dirname, "../../../../core/install.sh");

    const r = spawnSync("bash", [installSh, "--local-hooks"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, HOME: path.join(p.dir, "home") },
    });

    expect(r.status).toBe(0);
    expect(`${r.stdout}\n${r.stderr}`).not.toMatch(/Destination not found: --local-hooks/);
    expect(existsSync(path.join(p.dir, ".cursor/hooks/goal-stop.sh"))).toBe(true);
    expect(existsSync(path.join(p.dir, "GOAL.md"))).toBe(true);
  });
});

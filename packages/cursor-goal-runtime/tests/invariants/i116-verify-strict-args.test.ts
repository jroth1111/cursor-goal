import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

async function releaseReady(dir: string): Promise<void> {
  await writeFile(
    path.join(dir, ".cursor/goal/trajectory.json"),
    JSON.stringify({ phase: "VERIFY" }),
    "utf8",
  );
  await writeFile(
    path.join(dir, ".cursor/goal/discovery.json"),
    JSON.stringify({ completed: true, notes: "ok" }),
    "utf8",
  );
}

describe("I116 verify strict args", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("rejects unsupported verify args before writing release state", async () => {
    const p = await mkGitProject("i116-verify");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nlong enough goal\n## Checks\n- `true`\n",
      "utf8",
    );
    await releaseReady(p.dir);

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "verify", "--verfy"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unknown option: --verfy/);
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(false);
  });
});

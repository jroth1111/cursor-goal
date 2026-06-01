import { describe, it, expect, afterEach } from "vitest";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I206 init interactive dry-run", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("does not modify GOAL.md on init --interactive --dry-run", async () => {
    const p = await mkGitProject("i206-dry");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const goalPath = path.join(p.dir, "GOAL.md");
    const existing = "Existing governed goal";
    await writeFile(goalPath, existing, "utf8");
    const before = (await stat(goalPath)).mtimeMs;

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const input = "Dry run goal paragraph\nnpm test\n\nsrc/\n";
    const r = spawnSync("node", [cli, "init", "--interactive", "--dry-run"], {
      cwd: p.dir,
      encoding: "utf8",
      input,
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).not.toBe(0);
    expect(`${r.stdout}\n${r.stderr}`).toMatch(/GOAL\.md already exists/);
    const after = (await stat(goalPath)).mtimeMs;
    expect(after).toBe(before);
    expect(await readFile(goalPath, "utf8")).toBe(existing);
  });

  it("prints preview without writing on init --interactive --force --dry-run", async () => {
    const p = await mkGitProject("i206-force-dry");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "GOAL.md"), "Old content", "utf8");

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const input = "Forced dry goal\nnpm test\n\nsrc/\n";
    const r = spawnSync("node", [cli, "init", "--interactive", "--force", "--dry-run"], {
      cwd: p.dir,
      encoding: "utf8",
      input,
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Forced dry goal/);
    expect(`${r.stdout}\n${r.stderr}`).toMatch(/Would write/);
    expect(await readFile(path.join(p.dir, "GOAL.md"), "utf8")).toBe("Old content");
  });
});

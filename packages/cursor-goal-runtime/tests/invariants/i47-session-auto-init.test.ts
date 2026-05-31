import { describe, it, expect, afterEach } from "vitest";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { atomicWriteJson } from "../../src/lib/paths.js";

function expectHookOk(r: ReturnType<typeof spawnSync>): void {
  expect(r.status, r.stderr || r.stdout).toBe(0);
}

describe("I47 sessionStart auto-inits GOAL in fresh git repo", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;
  let restoreHome: () => void;

  afterEach(async () => {
    restore?.();
    restoreHome?.();
    await cleanup?.();
  });

  async function setupHome(): Promise<string> {
    const fakeHome = path.join(os.tmpdir(), `i47-home-${Date.now()}`);
    await mkdir(path.join(fakeHome, ".cursor/goal/templates"), { recursive: true });
    const template = path.resolve(
      import.meta.dirname,
      "../../../../core/.cursor/goal/templates/GOAL.md",
    );
    await copyFile(template, path.join(fakeHome, ".cursor/goal/templates/GOAL.md"));
    const prevHome = process.env.HOME;
    process.env.HOME = fakeHome;
    restoreHome = () => {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
    };
    return fakeHome;
  }

  it("auto default: does not auto-init GOAL.md on sessionStart", async () => {
    const fakeHome = await setupHome();
    const p = await mkGitProject("i47-auto");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-sessionStart.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: "{}",
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir, HOME: fakeHome },
    });
    expectHookOk(r);
    expect(existsSync(path.join(p.dir, "GOAL.md"))).toBe(false);
    expect(r.stdout).toMatch(/auto mode/i);
  });

  it("default_mode governed: creates GOAL.md but does not compile the placeholder template", async () => {
    const fakeHome = await setupHome();
    const p = await mkGitProject("i47-governed");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await atomicWriteJson(path.join(p.dir, ".cursor/goal/config.json"), {
      default_mode: "governed",
    });

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-sessionStart.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: "{}",
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir, HOME: fakeHome },
    });
    expectHookOk(r);

    expect(existsSync(path.join(p.dir, "GOAL.md"))).toBe(true);
    const manifest = path.join(p.dir, ".cursor/goal/manifest.json");
    const workUnits = path.join(p.dir, ".cursor/goal/work-units.json");
    expect(existsSync(manifest)).toBe(false);
    expect(existsSync(workUnits)).toBe(false);
    expect(r.stdout).toMatch(/initialized GOAL\.md/i);
  });
});

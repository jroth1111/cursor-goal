import { describe, it, expect, afterEach } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { mkGitProject } from "../helpers/git-fixture.js";
import { runDoctor } from "../../src/lib/doctor.js";

describe("I178 doctor strict stale global install", () => {
  let cleanupProject: (() => Promise<void>) | undefined;
  let tempDir = "";
  const oldCursorHome = process.env.CURSOR_HOME;
  const oldRuntime = process.env.CURSOR_GOAL_RUNTIME;
  const oldStrict = process.env.CURSOR_GOAL_STRICT;
  const oldProjectDir = process.env.CURSOR_PROJECT_DIR;

  afterEach(async () => {
    if (oldCursorHome === undefined) delete process.env.CURSOR_HOME;
    else process.env.CURSOR_HOME = oldCursorHome;
    if (oldRuntime === undefined) delete process.env.CURSOR_GOAL_RUNTIME;
    else process.env.CURSOR_GOAL_RUNTIME = oldRuntime;
    if (oldStrict === undefined) delete process.env.CURSOR_GOAL_STRICT;
    else process.env.CURSOR_GOAL_STRICT = oldStrict;
    if (oldProjectDir === undefined) delete process.env.CURSOR_PROJECT_DIR;
    else process.env.CURSOR_PROJECT_DIR = oldProjectDir;
    await cleanupProject?.();
    await rm(tempDir, { recursive: true, force: true });
    cleanupProject = undefined;
    tempDir = "";
  });

  async function setupStaleInstall(): Promise<{ sourceDir: string; cursorHome: string }> {
    const source = await mkGitProject("i178-source");
    cleanupProject = source.cleanup;
    tempDir = path.join(os.tmpdir(), `i178-cursor-${process.pid}-${Date.now()}`);
    const cursorHome = path.join(tempDir, "cursor");
    const runtime = path.join(cursorHome, "cursor-goal-runtime");
    const manifest = path.join(cursorHome, "cursor-goal/install-manifest.json");

    await mkdir(path.join(cursorHome, "hooks"), { recursive: true });
    await mkdir(path.join(runtime, "dist"), { recursive: true });
    await mkdir(path.dirname(manifest), { recursive: true });
    await writeFile(path.join(cursorHome, "hooks/goal-stop.sh"), "#!/usr/bin/env bash\n", "utf8");
    await writeFile(path.join(runtime, "dist/hook-stop.mjs"), "", "utf8");
    await writeFile(path.join(runtime, "package.json"), JSON.stringify({ version: "0.1.0" }), "utf8");
    await writeFile(manifest, JSON.stringify({ source: source.dir, git_sha: "deadbee" }), "utf8");
    process.env.CURSOR_HOME = cursorHome;
    delete process.env.CURSOR_GOAL_RUNTIME;
    return { sourceDir: source.dir, cursorHome };
  }

  it("escalates a stale global install warning to an error in strict mode", async () => {
    const { sourceDir } = await setupStaleInstall();

    process.env.CURSOR_GOAL_STRICT = "1";
    const issues = await runDoctor(sourceDir);

    expect(issues.some((issue) => issue.level === "error" && /Global runtime may be stale/.test(issue.message))).toBe(true);
  });

  it("accepts doctor --strict and exits nonzero on stale global install", async () => {
    const { sourceDir, cursorHome } = await setupStaleInstall();
    process.env.CURSOR_PROJECT_DIR = sourceDir;
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "doctor", "--strict", "--json"], {
      cwd: sourceDir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_HOME: cursorHome, CURSOR_PROJECT_DIR: sourceDir },
    });

    expect(r.status).toBe(1);
    const report = JSON.parse(r.stdout) as { issues?: Array<{ level: string; message: string }> };
    expect(report.issues?.some((issue) => issue.level === "error" && /Global runtime may be stale/.test(issue.message))).toBe(true);
    expect(execSync("git rev-parse --short HEAD", { cwd: sourceDir, encoding: "utf8" }).trim()).toMatch(/^[a-f0-9]+$/);
  });
});

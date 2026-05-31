import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { mkGitProject } from "../helpers/git-fixture.js";
import { runDoctor } from "../../src/lib/doctor.js";

describe("I143 doctor current global manifest", () => {
  let cleanupProject: (() => Promise<void>) | undefined;
  let tempDir = "";
  const oldCursorHome = process.env.CURSOR_HOME;
  const oldRuntime = process.env.CURSOR_GOAL_RUNTIME;

  afterEach(async () => {
    if (oldCursorHome === undefined) delete process.env.CURSOR_HOME;
    else process.env.CURSOR_HOME = oldCursorHome;
    if (oldRuntime === undefined) delete process.env.CURSOR_GOAL_RUNTIME;
    else process.env.CURSOR_GOAL_RUNTIME = oldRuntime;
    await cleanupProject?.();
    await rm(tempDir, { recursive: true, force: true });
    cleanupProject = undefined;
    tempDir = "";
  });

  async function setupGlobalInstall(installedSha?: string): Promise<{ sourceDir: string }> {
    const source = await mkGitProject("i143-source");
    cleanupProject = source.cleanup;
    tempDir = path.join(os.tmpdir(), `i143-cursor-${Date.now()}`);
    const cursorHome = path.join(tempDir, "cursor");
    const runtime = path.join(cursorHome, "cursor-goal-runtime");
    const manifest = path.join(cursorHome, "cursor-goal/install-manifest.json");
    const head = execSync("git rev-parse --short HEAD", {
      cwd: source.dir,
      encoding: "utf8",
    }).trim();

    await mkdir(path.join(cursorHome, "hooks"), { recursive: true });
    await mkdir(path.join(runtime, "dist"), { recursive: true });
    await mkdir(path.dirname(manifest), { recursive: true });
    await writeFile(path.join(cursorHome, "hooks/goal-stop.sh"), "#!/usr/bin/env bash\n", "utf8");
    await writeFile(path.join(runtime, "dist/hook-stop.mjs"), "", "utf8");
    await writeFile(path.join(runtime, "package.json"), JSON.stringify({ version: "0.1.0" }), "utf8");
    await writeFile(
      manifest,
      JSON.stringify({ source: source.dir, git_sha: installedSha ?? head }),
      "utf8",
    );

    process.env.CURSOR_HOME = cursorHome;
    delete process.env.CURSOR_GOAL_RUNTIME;

    return { sourceDir: source.dir };
  }

  async function setupGlobalInstallWithMissingSource(): Promise<{ root: string }> {
    tempDir = path.join(os.tmpdir(), `i143-cursor-missing-${Date.now()}`);
    const cursorHome = path.join(tempDir, "cursor");
    const runtime = path.join(cursorHome, "cursor-goal-runtime");
    const manifest = path.join(cursorHome, "cursor-goal/install-manifest.json");
    const missingSource = path.join(tempDir, "missing-source");

    await mkdir(path.join(cursorHome, "hooks"), { recursive: true });
    await mkdir(path.join(runtime, "dist"), { recursive: true });
    await mkdir(path.dirname(manifest), { recursive: true });
    await writeFile(path.join(cursorHome, "hooks/goal-stop.sh"), "#!/usr/bin/env bash\n", "utf8");
    await writeFile(path.join(runtime, "dist/hook-stop.mjs"), "", "utf8");
    await writeFile(path.join(runtime, "package.json"), JSON.stringify({ version: "0.1.0" }), "utf8");
    await writeFile(
      manifest,
      JSON.stringify({ source: missingSource, git_sha: "deadbee" }),
      "utf8",
    );

    process.env.CURSOR_HOME = cursorHome;
    delete process.env.CURSOR_GOAL_RUNTIME;

    return { root: tempDir };
  }

  it("does not warn stale when the manifest git_sha matches the source repo HEAD", async () => {
    const { sourceDir } = await setupGlobalInstall();

    const issues = await runDoctor(sourceDir);

    expect(issues.some((issue) => /Global runtime may be stale/.test(issue.message))).toBe(false);
  });

  it("still warns stale when the manifest git_sha differs from the source repo HEAD", async () => {
    const { sourceDir } = await setupGlobalInstall("not-current-sha");

    const issues = await runDoctor(sourceDir);

    expect(issues.some((issue) => /Global runtime may be stale/.test(issue.message))).toBe(true);
  });

  it("warns when the manifest source repo is unavailable", async () => {
    const { root } = await setupGlobalInstallWithMissingSource();

    const issues = await runDoctor(root);

    expect(issues.some((issue) => /Global install source unavailable/.test(issue.message))).toBe(
      true,
    );
  });
});

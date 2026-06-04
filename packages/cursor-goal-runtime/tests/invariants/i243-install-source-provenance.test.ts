import { describe, it, expect, afterEach } from "vitest";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkGitProject } from "../helpers/git-fixture.js";
import { runDoctor } from "../../src/lib/doctor.js";
import { workingTreeFingerprint } from "../../src/lib/git-state.js";
import { computeSourceMetadata } from "../../../../scripts/source-metadata.mjs";

describe("I243 global install source provenance", () => {
  let fakeCursorHome = "";
  let fakeHome = "";
  let fakeBin = "";
  let dirtyMarker = "";
  let cleanupProject: (() => Promise<void>) | undefined;
  const oldCursorHome = process.env.CURSOR_HOME;
  const oldRuntime = process.env.CURSOR_GOAL_RUNTIME;

  afterEach(async () => {
    if (oldCursorHome === undefined) delete process.env.CURSOR_HOME;
    else process.env.CURSOR_HOME = oldCursorHome;
    if (oldRuntime === undefined) delete process.env.CURSOR_GOAL_RUNTIME;
    else process.env.CURSOR_GOAL_RUNTIME = oldRuntime;
    await cleanupProject?.();
    cleanupProject = undefined;
    await rm(dirtyMarker, { force: true });
    dirtyMarker = "";
    rmSync(fakeCursorHome, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
    fakeCursorHome = "";
    fakeHome = "";
    fakeBin = "";
  });

  async function makeFakeInstallEnv(prefix: string): Promise<void> {
    const suffix = `${process.pid}-${Date.now()}`;
    fakeCursorHome = path.join(os.tmpdir(), `${prefix}-cursor-${suffix}`);
    fakeHome = path.join(os.tmpdir(), `${prefix}-home-${suffix}`);
    fakeBin = path.join(os.tmpdir(), `${prefix}-bin-${suffix}`);
    await mkdir(fakeBin, { recursive: true });
    const fakeNpm = path.join(fakeBin, "npm");
    await writeFile(fakeNpm, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(fakeNpm, 0o755);
  }

  it("records dirty source fingerprint and dirty files in install manifest", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../");
    await makeFakeInstallEnv("i243");
    dirtyMarker = path.join(repoRoot, `.i243-dirty-${process.pid}-${Date.now()}`);
    await writeFile(dirtyMarker, "dirty install provenance marker\n", "utf8");

    const script = path.resolve(repoRoot, "scripts/install-global.sh");
    const install = spawnSync("bash", [script, "--skip-build"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CURSOR_HOME: fakeCursorHome,
        HOME: fakeHome,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      },
    });

    expect(install.status, install.stderr || install.stdout).toBe(0);
    const manifest = JSON.parse(
      await readFile(path.join(fakeCursorHome, "cursor-goal/install-manifest.json"), "utf8"),
    ) as {
      source_dirty?: boolean;
      source_tree?: string;
      source_dirty_files?: string[];
    };
    expect(manifest.source_dirty).toBe(true);
    expect(manifest.source_tree).toMatch(/-wt-[a-f0-9]+$/);
    expect(manifest.source_dirty_files ?? []).toContain(path.basename(dirtyMarker));
  });

  it("doctor --strict detects source-tree mismatch even when git sha still matches", async () => {
    const source = await mkGitProject("i243-source");
    cleanupProject = source.cleanup;
    const head = execSync("git rev-parse HEAD", {
      cwd: source.dir,
      encoding: "utf8",
    }).trim();
    const shortHead = execSync("git rev-parse --short HEAD", {
      cwd: source.dir,
      encoding: "utf8",
    }).trim();
    await makeFakeInstallEnv("i243-doctor");
    const runtime = path.join(fakeCursorHome, "cursor-goal-runtime");
    const manifest = path.join(fakeCursorHome, "cursor-goal/install-manifest.json");
    await mkdir(path.join(fakeCursorHome, "hooks"), { recursive: true });
    await mkdir(path.join(runtime, "dist"), { recursive: true });
    await mkdir(path.dirname(manifest), { recursive: true });
    await writeFile(path.join(fakeCursorHome, "hooks/goal-stop.sh"), "#!/usr/bin/env bash\n", "utf8");
    await writeFile(path.join(runtime, "dist/hook-stop.mjs"), "", "utf8");
    await writeFile(path.join(runtime, "package.json"), JSON.stringify({ version: "0.1.0" }), "utf8");
    await writeFile(
      manifest,
      JSON.stringify({
        source: source.dir,
        git_sha: shortHead,
        source_tree: `${head}-wt-deadbeef`,
        source_dirty: true,
      }),
      "utf8",
    );
    process.env.CURSOR_HOME = fakeCursorHome;
    delete process.env.CURSOR_GOAL_RUNTIME;

    const issues = await runDoctor(source.dir, { strict: true });
    expect(
      issues.some(
        (issue) =>
          issue.level === "error" &&
          /Global runtime source tree differs/.test(issue.message),
      ),
    ).toBe(true);
  });

  it("source metadata preserves the first character of modified tracked paths", async () => {
    const source = await mkGitProject("i243-modified-path");
    cleanupProject = source.cleanup;
    await writeFile(path.join(source.dir, ".gitkeep"), "tracked dirty\n", "utf8");
    await writeFile(path.join(source.dir, "CAPABILITY.md"), "changed\n", "utf8");

    const metadata = computeSourceMetadata(source.dir);
    expect(metadata.source_dirty).toBe(true);
    expect(workingTreeFingerprint(source.dir)).toBe(metadata.source_tree);
    expect(metadata.source_dirty_files).toContain(".gitkeep");
    expect(metadata.source_dirty_files).toContain("CAPABILITY.md");
    expect(metadata.source_dirty_files).not.toContain("APABILITY.md");
  });

  it("installer refreshes source metadata after build before writing manifest", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../");
    const script = await readFile(path.join(repoRoot, "scripts/install-global.sh"), "utf8");
    const buildIdx = script.indexOf('if [[ "$SKIP_BUILD" -eq 0 ]]');
    const refreshIdx = script.indexOf("refresh_source_metadata", buildIdx);
    const manifestIdx = script.indexOf("write_install_manifest 0");

    expect(buildIdx).toBeGreaterThanOrEqual(0);
    expect(refreshIdx).toBeGreaterThan(buildIdx);
    expect(manifestIdx).toBeGreaterThan(refreshIdx);
  });
});

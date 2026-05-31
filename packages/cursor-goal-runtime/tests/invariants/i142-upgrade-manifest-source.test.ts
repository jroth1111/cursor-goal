import { describe, it, expect, afterEach } from "vitest";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGlobalUpgrade } from "../../src/lib/upgrade.js";

describe("I142 upgrade manifest source", () => {
  let tempDir = "";
  const oldCursorHome = process.env.CURSOR_HOME;
  const oldPath = process.env.PATH;
  const oldMarker = process.env.I142_MARKER;

  afterEach(() => {
    if (oldCursorHome === undefined) delete process.env.CURSOR_HOME;
    else process.env.CURSOR_HOME = oldCursorHome;
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    if (oldMarker === undefined) delete process.env.I142_MARKER;
    else process.env.I142_MARKER = oldMarker;
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  it("runs the installer from the global install manifest source", async () => {
    tempDir = path.join(os.tmpdir(), `i142-upgrade-${Date.now()}`);
    const fakeCursorHome = path.join(tempDir, "cursor");
    const fakeSource = path.join(tempDir, "source-repo");
    const fakeBin = path.join(tempDir, "bin");
    const marker = path.join(tempDir, "bash-argv.txt");
    const manifest = path.join(fakeCursorHome, "cursor-goal/install-manifest.json");
    const sourceInstaller = path.join(fakeSource, "scripts/install-global.sh");

    await mkdir(path.dirname(manifest), { recursive: true });
    await mkdir(path.dirname(sourceInstaller), { recursive: true });
    await mkdir(fakeBin, { recursive: true });
    await writeFile(
      manifest,
      JSON.stringify({ source: fakeSource, git_sha: "old-sha" }),
      "utf8",
    );
    await writeFile(sourceInstaller, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await writeFile(
      path.join(fakeBin, "bash"),
      "#!/bin/sh\nprintf '%s\\n' \"$1\" > \"$I142_MARKER\"\nexit 0\n",
      "utf8",
    );
    await chmod(path.join(fakeBin, "bash"), 0o755);

    process.env.CURSOR_HOME = fakeCursorHome;
    process.env.PATH = `${fakeBin}:${oldPath ?? ""}`;
    process.env.I142_MARKER = marker;

    const r = runGlobalUpgrade();

    expect(r.status).toBe(0);
    expect(await readFile(marker, "utf8")).toBe(`${sourceInstaller}\n`);
  });
});

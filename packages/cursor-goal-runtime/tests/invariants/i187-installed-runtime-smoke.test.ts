import { describe, it, expect, afterEach } from "vitest";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

describe("I187 installed runtime smoke verification", () => {
  let fakeCursorHome = "";
  let fakeHome = "";
  let fakeBin = "";

  afterEach(() => {
    rmSync(fakeCursorHome, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
    fakeCursorHome = "";
    fakeHome = "";
    fakeBin = "";
  });

  it("proves the installed Node CLI and hook can import their runtime dependencies", async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    fakeCursorHome = path.join(os.tmpdir(), `i187-cursor-${suffix}`);
    fakeHome = path.join(os.tmpdir(), `i187-home-${suffix}`);
    fakeBin = path.join(os.tmpdir(), `i187-bin-${suffix}`);
    await mkdir(fakeBin, { recursive: true });
    const fakeNpm = path.join(fakeBin, "npm");
    await writeFile(fakeNpm, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(fakeNpm, 0o755);

    const script = path.resolve(import.meta.dirname, "../../../../scripts/install-global.sh");
    const repoRoot = path.resolve(import.meta.dirname, "../../../../../");
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
    const report = JSON.parse(
      await readFile(path.join(fakeCursorHome, "cursor-goal/install-verify.json"), "utf8"),
    ) as { checks?: Record<string, { ok?: boolean }> };
    expect(report.checks?.runtime_cli_smoke?.ok).toBe(true);
    expect(report.checks?.runtime_hook_smoke?.ok).toBe(true);

    const help = spawnSync("node", [path.join(fakeCursorHome, "cursor-goal-runtime/dist/cli.js"), "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, CURSOR_HOME: fakeCursorHome, HOME: fakeHome },
    });
    expect(help.status, help.stderr || help.stdout).toBe(0);
    expect(help.stdout).toContain("cursor-goal");
  });
});

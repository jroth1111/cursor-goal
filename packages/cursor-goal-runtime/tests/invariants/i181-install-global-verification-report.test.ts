import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

describe("I181 global install verification report", () => {
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

  it("writes an installed-snapshot verification report after a global install", async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    fakeCursorHome = path.join(os.tmpdir(), `i181-cursor-${suffix}`);
    fakeHome = path.join(os.tmpdir(), `i181-home-${suffix}`);
    fakeBin = path.join(os.tmpdir(), `i181-bin-${suffix}`);
    await mkdir(fakeBin, { recursive: true });
    await writeFile(path.join(fakeBin, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    const script = path.resolve(import.meta.dirname, "../../../../scripts/install-global.sh");
    const repoRoot = path.resolve(import.meta.dirname, "../../../../../");
    const r = spawnSync("bash", [script, "--skip-build"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CURSOR_HOME: fakeCursorHome,
        HOME: fakeHome,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(/Post-install verification complete/);
    const reportPath = path.join(fakeCursorHome, "cursor-goal/install-verify.json");
    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(await readFile(reportPath, "utf8")) as {
      ok?: boolean;
      checks?: Record<string, { ok?: boolean }>;
    };
    expect(report.ok).toBe(true);
    expect(report.checks?.manifest_git_sha?.ok).toBe(true);
    expect(report.checks?.runtime_files?.ok).toBe(true);
    expect(report.checks?.hook_resolution?.ok).toBe(true);
    expect(report.checks?.schemas?.ok).toBe(true);
    expect(report.checks?.templates?.ok).toBe(true);
    expect(report.checks?.hooks?.ok).toBe(true);
  });
});

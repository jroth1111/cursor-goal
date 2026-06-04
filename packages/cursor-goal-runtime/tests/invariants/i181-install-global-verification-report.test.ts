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

  it("post-install hook_resolution ignores CURSOR_GOAL_RUNTIME from the caller env", async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    fakeCursorHome = path.join(os.tmpdir(), `i181-cursor-override-${suffix}`);
    fakeHome = path.join(os.tmpdir(), `i181-home-override-${suffix}`);
    fakeBin = path.join(os.tmpdir(), `i181-bin-override-${suffix}`);
    await mkdir(fakeBin, { recursive: true });
    await writeFile(path.join(fakeBin, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    const script = path.resolve(import.meta.dirname, "../../../../scripts/install-global.sh");
    const repoRoot = path.resolve(import.meta.dirname, "../../../../../");
    const runtimeRoot = path.resolve(import.meta.dirname, "../../");
    const r = spawnSync("bash", [script, "--skip-build"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CURSOR_HOME: fakeCursorHome,
        HOME: fakeHome,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        CURSOR_GOAL_RUNTIME: runtimeRoot,
      },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    const report = JSON.parse(
      await readFile(path.join(fakeCursorHome, "cursor-goal/install-verify.json"), "utf8"),
    ) as { ok?: boolean; checks?: Record<string, { ok?: boolean }> };
    expect(report.ok).toBe(true);
    expect(report.checks?.hook_resolution?.ok).toBe(true);
  });

  it("restores the previous global install snapshot when installation fails after mutation starts", async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    fakeCursorHome = path.join(os.tmpdir(), `i181-cursor-rollback-${suffix}`);
    fakeHome = path.join(os.tmpdir(), `i181-home-rollback-${suffix}`);
    fakeBin = path.join(os.tmpdir(), `i181-bin-rollback-${suffix}`);
    await mkdir(fakeBin, { recursive: true });
    await writeFile(
      path.join(fakeBin, "npm"),
      "#!/bin/sh\necho npm forced failure >&2\nexit 42\n",
      { mode: 0o755 },
    );

    const oldRuntimeFile = path.join(fakeCursorHome, "cursor-goal-runtime/dist/hook-stop.mjs");
    const oldHookFile = path.join(fakeCursorHome, "hooks/goal-stop.sh");
    const oldSchemaFile = path.join(fakeCursorHome, "goal/schemas/old-schema.json");
    const oldTemplateFile = path.join(fakeCursorHome, "goal/templates/old-template.md");
    await mkdir(path.dirname(oldRuntimeFile), { recursive: true });
    await mkdir(path.dirname(oldHookFile), { recursive: true });
    await mkdir(path.dirname(oldSchemaFile), { recursive: true });
    await mkdir(path.dirname(oldTemplateFile), { recursive: true });
    await writeFile(oldRuntimeFile, "old runtime\n", "utf8");
    await writeFile(oldHookFile, "old hook\n", "utf8");
    await writeFile(oldSchemaFile, "old schema\n", "utf8");
    await writeFile(oldTemplateFile, "old template\n", "utf8");

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

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/npm forced failure/);
    expect(await readFile(oldRuntimeFile, "utf8")).toBe("old runtime\n");
    expect(await readFile(oldHookFile, "utf8")).toBe("old hook\n");
    expect(await readFile(oldSchemaFile, "utf8")).toBe("old schema\n");
    expect(await readFile(oldTemplateFile, "utf8")).toBe("old template\n");
    const rollbackRoot = path.join(fakeCursorHome, "cursor-goal");
    expect(existsSync(path.join(rollbackRoot, "install-rollback.tgz"))).toBe(true);
  });
});

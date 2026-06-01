import { describe, it, expect, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { goalDir, passportsDir } from "../../src/lib/paths.js";

describe("I191 incidents bounded since filter", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;
  let tempDir = "";

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    await rm(tempDir, { recursive: true, force: true });
    cleanup = undefined;
    restore = undefined;
    tempDir = "";
  });

  it("excludes undated records from --since today while keeping them under --since all", async () => {
    const p = await mkGitProject("i191-undated-incidents");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    tempDir = path.join(os.tmpdir(), `i191-cursor-${process.pid}-${Date.now()}`);
    const cursorHome = path.join(tempDir, "cursor");
    await mkdir(passportsDir(p.dir), { recursive: true });
    await mkdir(path.join(goalDir(p.dir), "evidence"), { recursive: true });
    await mkdir(path.join(cursorHome, "projects/test/terminals"), { recursive: true });
    await writeFile(
      path.join(passportsDir(p.dir), "SESSION_END.json"),
      JSON.stringify({ status: "SESSION_END", failure_class: "green_but_unreleased" }),
      "utf8",
    );
    await writeFile(
      path.join(goalDir(p.dir), "evidence/proof-runs.jsonl"),
      `${JSON.stringify({ cmd: "npm test", ok: false, output: "old undated failure" })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(cursorHome, "projects/test/terminals/100.txt"),
      `pid: 100\ncwd: "${p.dir}"\ncommand: "npm test"\n---\nexit_code: unknown\n`,
      "utf8",
    );

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const today = spawnSync("node", [cli, "incidents", "--since", "today", "--json"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir, CURSOR_HOME: cursorHome },
    });
    const all = spawnSync("node", [cli, "incidents", "--since", "all", "--json"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir, CURSOR_HOME: cursorHome },
    });

    expect(today.status, today.stderr || today.stdout).toBe(0);
    expect(all.status, all.stderr || all.stdout).toBe(0);
    const todayReport = JSON.parse(today.stdout) as { clusters?: Record<string, number> };
    const allReport = JSON.parse(all.stdout) as { clusters?: Record<string, number> };
    expect(todayReport.clusters?.green_but_unreleased).toBeUndefined();
    expect(todayReport.clusters?.proof_run_failed).toBeUndefined();
    expect(todayReport.clusters?.terminal_unknown_exit).toBeUndefined();
    expect(allReport.clusters?.green_but_unreleased).toBe(1);
    expect(allReport.clusters?.proof_run_failed).toBe(1);
    expect(allReport.clusters?.terminal_unknown_exit).toBe(1);
  });
});

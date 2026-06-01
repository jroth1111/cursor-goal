import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { goalDir, passportsDir } from "../../src/lib/paths.js";

describe("I186 incidents since today", () => {
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

  it("clusters session-end, proof-run, and Cursor terminal failures", async () => {
    const p = await mkGitProject("i186-incidents");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    tempDir = path.join(os.tmpdir(), `i186-cursor-${process.pid}-${Date.now()}`);
    const cursorHome = path.join(tempDir, "cursor");
    await mkdir(passportsDir(p.dir), { recursive: true });
    await mkdir(path.join(goalDir(p.dir), "evidence"), { recursive: true });
    await mkdir(path.join(cursorHome, "projects/test/terminals"), { recursive: true });
    await writeFile(
      path.join(passportsDir(p.dir), "SESSION_END.json"),
      JSON.stringify({
        status: "SESSION_END",
        at: new Date().toISOString(),
        failure_class: "green_but_unreleased",
        why_no_release: "checks passed but no release",
      }),
      "utf8",
    );
    await writeFile(
      path.join(goalDir(p.dir), "evidence/proof-runs.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), cmd: "npm test", ok: false, output: "1 failed" })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(cursorHome, "projects/test/terminals/100.txt"),
      `pid: 100\ncwd: "${p.dir}"\ncommand: "rtk npm run build"\nstarted_at: ${new Date().toISOString()}\n---\nexit_code: unknown\nelapsed_ms: 600000\n`,
      "utf8",
    );

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "incidents", "--since", "today", "--json"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir, CURSOR_HOME: cursorHome },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    const report = JSON.parse(r.stdout) as {
      clusters?: Record<string, number>;
      incidents?: Array<{ kind: string }>;
    };
    expect(report.clusters?.green_but_unreleased).toBe(1);
    expect(report.clusters?.proof_run_failed).toBe(1);
    expect(report.clusters?.terminal_unknown_exit).toBe(1);
    expect(report.incidents?.some((incident) => incident.kind === "terminal_unknown_exit")).toBe(true);
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { readFile, access, mkdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { orchestratorMarkerPath } from "../../src/lib/orchestrator.js";

describe("I216 orchestrator CLI lifecycle", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  function runCli(dir: string, args: string[]) {
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    return spawnSync("node", [cli, ...args], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: dir },
    });
  }

  it("init + start writes marker and governed session", async () => {
    const p = await mkGitProject("i216-orch-cli");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\norch test\n## Checks\n- `true`\n",
      "utf8",
    );
    await mkdir(path.join(p.dir, ".cursor/goal/scripts"), { recursive: true });
    await copyFile(
      path.resolve(
        import.meta.dirname,
        "../../../../core/.cursor/goal/scripts/check-orchestrator-status.mjs",
      ),
      path.join(p.dir, ".cursor/goal/scripts/check-orchestrator-status.mjs"),
    );

    let r = runCli(p.dir, ["orchestrator", "init", "--dir", ".cursor-audit/test-orch"]);
    expect(r.status, r.stderr || r.stdout).toBe(0);

    r = runCli(p.dir, ["orchestrator", "start"]);
    expect(r.status, r.stderr).toBe(0);

    const config = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/orchestrator.json"), "utf8"),
    ) as { audit_dir: string; marker: string };
    const marker = orchestratorMarkerPath(p.dir, {
      audit_dir: config.audit_dir,
      marker: config.marker,
      status_file: "ORCHESTRATOR_STATUS.json",
      master_status: "MASTER_STATUS.md",
      final_report: "FINAL_REPORT.md",
      required_done: [],
      check_command: "node .cursor/goal/scripts/check-orchestrator-status.mjs",
    });
    await access(marker);
    const session = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/session-mode.json"), "utf8"),
    ) as { mode: string };
    expect(session.mode).toBe("governed");
  });
});

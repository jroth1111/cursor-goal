import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkGitProject } from "../helpers/git-fixture.js";
import { goalDir } from "../../src/lib/paths.js";
import { sessionEndMarkerPath } from "../../src/lib/disposition.js";

describe("I179 session-end diagnostics", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let tempDir = "";

  afterEach(async () => {
    await cleanup?.();
    await rm(tempDir, { recursive: true, force: true });
    cleanup = undefined;
    tempDir = "";
  });

  it("records root, runtime, install, stop, and check context when ending without RELEASE", async () => {
    const p = await mkGitProject("i179-session-end-diagnostics");
    cleanup = p.cleanup;
    tempDir = path.join(os.tmpdir(), `i179-cursor-${process.pid}-${Date.now()}`);
    const cursorHome = path.join(tempDir, "cursor");
    const runtimeRoot = path.resolve(import.meta.dirname, "../../");
    await mkdir(path.join(cursorHome, "cursor-goal"), { recursive: true });
    await writeFile(
      path.join(cursorHome, "cursor-goal/install-manifest.json"),
      JSON.stringify({ source: p.dir, git_sha: "deadbee", runtime: runtimeRoot }),
      "utf8",
    );
    await mkdir(path.join(goalDir(p.dir), "evidence"), { recursive: true });
    await writeFile(
      path.join(goalDir(p.dir), "stop-trace.jsonl"),
      `${JSON.stringify({ at: "2026-06-01T00:00:00Z", level_failed: "L3", failures: ["npm test"], pipeline_result: "continue" })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(goalDir(p.dir), "evidence/proof-runs.jsonl"),
      `${JSON.stringify({ at: "2026-06-01T00:00:01Z", cmd: "npm test", ok: false, tree: "abc", output: "failed" })}\n`,
      "utf8",
    );

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-sessionEnd.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ conversation_id: "agent-a" }),
      encoding: "utf8",
      env: {
        ...process.env,
        CURSOR_HOME: cursorHome,
        CURSOR_PROJECT_DIR: p.dir,
        CURSOR_GOAL_RUNTIME: runtimeRoot,
      },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    const marker = JSON.parse(await readFile(sessionEndMarkerPath(p.dir), "utf8")) as {
      root?: string;
      git_tree?: string;
      runtime_root?: string;
      install_git_sha?: string;
      why_no_release?: string;
      last_stop_trace?: { level_failed?: string; pipeline_result?: string };
      last_check_result?: { cmd?: string; ok?: boolean; output?: string };
    };
    expect(marker.root).toBe(realpathSync(p.dir));
    expect(marker.git_tree).toMatch(/^[a-f0-9]/);
    expect(marker.runtime_root).toBe(runtimeRoot);
    expect(marker.install_git_sha).toBe("deadbee");
    expect(marker.why_no_release).toMatch(/L3|npm test|last check/i);
    expect(marker.last_stop_trace?.level_failed).toBe("L3");
    expect(marker.last_stop_trace?.pipeline_result).toBe("continue");
    expect(marker.last_check_result?.cmd).toBe("npm test");
    expect(marker.last_check_result?.ok).toBe(false);
  });
});

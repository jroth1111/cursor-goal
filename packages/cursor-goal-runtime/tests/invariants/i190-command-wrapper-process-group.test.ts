import { describe, it, expect, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { goalDir } from "../../src/lib/paths.js";

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("I190 cursor-goal run process-group timeout cleanup", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  it("kills child processes started by a timed-out command", async () => {
    const p = await mkGitProject("i190-run-process-group");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const script = [
      "const { spawn } = require('node:child_process');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      "console.log(child.pid);",
      "setInterval(() => {}, 1000);",
    ].join(" ");

    const r = spawnSync("node", [cli, "run", "--timeout-ms", "150", "--", "node", "-e", script], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).not.toBe(0);
    const raw = await readFile(path.join(goalDir(p.dir), "evidence/proof-runs.jsonl"), "utf8");
    const row = JSON.parse(raw.trim().split(/\r?\n/).at(-1) ?? "{}") as {
      timed_out?: boolean;
      output?: string;
    };
    expect(row.timed_out).toBe(true);
    const childPid = Number(row.output?.match(/\b(\d{2,})\b/)?.[1]);
    expect(Number.isFinite(childPid)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const alive = pidAlive(childPid);
    if (alive) {
      try {
        process.kill(childPid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    expect(alive).toBe(false);
  });
});

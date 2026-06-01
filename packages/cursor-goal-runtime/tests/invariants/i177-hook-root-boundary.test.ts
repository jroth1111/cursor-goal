import { describe, it, expect, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { projectRoot } from "../../src/lib/paths.js";

describe("I177 hook root boundary", () => {
  let tempDir = "";
  const oldCwd = process.cwd();
  const oldCursorHome = process.env.CURSOR_HOME;
  const oldHome = process.env.HOME;
  const oldProjectDir = process.env.CURSOR_PROJECT_DIR;
  const oldRuntime = process.env.CURSOR_GOAL_RUNTIME;

  afterEach(async () => {
    process.chdir(oldCwd);
    if (oldCursorHome === undefined) delete process.env.CURSOR_HOME;
    else process.env.CURSOR_HOME = oldCursorHome;
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldProjectDir === undefined) delete process.env.CURSOR_PROJECT_DIR;
    else process.env.CURSOR_PROJECT_DIR = oldProjectDir;
    if (oldRuntime === undefined) delete process.env.CURSOR_GOAL_RUNTIME;
    else process.env.CURSOR_GOAL_RUNTIME = oldRuntime;
    await rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  it("runtime projectRoot rejects the global hooks directory when CURSOR_PROJECT_DIR is missing", async () => {
    tempDir = path.join(os.tmpdir(), `i177-runtime-${process.pid}-${Date.now()}`);
    const cursorHome = path.join(tempDir, "cursor");
    const hooksDir = path.join(cursorHome, "hooks");
    await mkdir(hooksDir, { recursive: true });
    process.env.CURSOR_HOME = cursorHome;
    delete process.env.CURSOR_PROJECT_DIR;
    process.chdir(hooksDir);

    expect(() => projectRoot()).toThrow(/CURSOR_PROJECT_DIR|hooks directory/i);
  });

  it("core hooks do not write governance state under the global hooks directory", async () => {
    tempDir = path.join(os.tmpdir(), `i177-core-${process.pid}-${Date.now()}`);
    const cursorHome = path.join(tempDir, "cursor");
    const hooksDir = path.join(cursorHome, "hooks");
    await mkdir(hooksDir, { recursive: true });
    const script = path.resolve(import.meta.dirname, "../../../../core/.cursor/hooks/goal-session-end.sh");
    const env = {
      ...process.env,
      CURSOR_HOME: cursorHome,
      HOME: tempDir,
    };
    delete env.CURSOR_PROJECT_DIR;
    delete env.CURSOR_GOAL_RUNTIME;

    const r = spawnSync("bash", [script], {
      cwd: hooksDir,
      input: JSON.stringify({ conversation_id: "agent-a" }),
      encoding: "utf8",
      env,
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(/CURSOR_PROJECT_DIR|hooks directory/i);
    expect(existsSync(path.join(hooksDir, ".cursor/goal"))).toBe(false);
  });
});

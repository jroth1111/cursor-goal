import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I193 session-end clear command", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("requires --force and removes SESSION_END.json", async () => {
    const p = await mkGitProject("i193-session-end-clear");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const sessionEndPath = path.join(p.dir, ".cursor/goal/passports/SESSION_END.json");
    await writeFile(
      sessionEndPath,
      JSON.stringify({ status: "SESSION_END", reason: "session_end_without_release" }, null, 2),
      "utf8",
    );
    expect(existsSync(sessionEndPath)).toBe(true);

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r1 = spawnSync("node", [cli, "session-end", "clear"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r1.status).toBe(1);
    expect(existsSync(sessionEndPath)).toBe(true);

    const r2 = spawnSync("node", [cli, "session-end", "clear", "--force"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r2.status).toBe(0);
    expect(existsSync(sessionEndPath)).toBe(false);

    // Cleanup any md companion if created by the command.
    await rm(path.join(p.dir, ".cursor/goal/passports/SESSION_END.md"), { force: true });
  });
});


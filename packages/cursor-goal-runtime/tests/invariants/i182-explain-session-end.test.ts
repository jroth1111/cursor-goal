import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { passportsDir } from "../../src/lib/paths.js";

describe("I182 explain session-end", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  it("prints the concrete reason the last session ended without release", async () => {
    const p = await mkGitProject("i182-explain-session-end");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(passportsDir(p.dir), { recursive: true });
    await writeFile(
      path.join(passportsDir(p.dir), "SESSION_END.json"),
      JSON.stringify({
        status: "SESSION_END",
        reason: "session_end_without_release",
        failure_class: "green_but_unreleased",
        why_no_release: "checks passed but RELEASE passport was not written",
        root: p.dir,
        runtime_root: "/tmp/runtime",
        install_git_sha: "abc1234",
        last_check_result: { cmd: "npm test", ok: true, elapsed_ms: 123 },
      }),
      "utf8",
    );

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "explain", "session-end"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(/green_but_unreleased/);
    expect(r.stdout).toMatch(/checks passed/i);
    expect(r.stdout).toMatch(/npm test/);
  });

  it("emits session-end diagnostics as JSON", async () => {
    const p = await mkGitProject("i182-explain-session-end-json");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(passportsDir(p.dir), { recursive: true });
    await writeFile(
      path.join(passportsDir(p.dir), "SESSION_END.json"),
      JSON.stringify({ status: "SESSION_END", failure_class: "checks_failed" }),
      "utf8",
    );

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "explain", "session-end", "--json"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    const parsed = JSON.parse(r.stdout) as { failure_class?: string };
    expect(parsed.failure_class).toBe("checks_failed");
  });
});

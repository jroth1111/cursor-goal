import { describe, it, expect, afterEach } from "vitest";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { runChecks } from "../../src/lib/run-checks.js";

describe("I70 run-checks optional timeout", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;
  const prev = process.env.CURSOR_GOAL_CHECK_TIMEOUT_MS;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    restore = undefined;
    cleanup = undefined;
    if (prev === undefined) delete process.env.CURSOR_GOAL_CHECK_TIMEOUT_MS;
    else process.env.CURSOR_GOAL_CHECK_TIMEOUT_MS = prev;
  });

  async function project(name: string): Promise<{ dir: string }> {
    const p = await mkGitProject(name);
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/goal/evidence"), { recursive: true });
    return p;
  }

  it("bounds a hung check when CURSOR_GOAL_CHECK_TIMEOUT_MS is set", async () => {
    const p = await project("i70-timeout");
    process.env.CURSOR_GOAL_CHECK_TIMEOUT_MS = "100";
    const t0 = Date.now();
    const res = await runChecks(p.dir, ["sleep 2"]);
    const elapsed = Date.now() - t0;
    expect(res[0].ok).toBe(false);
    expect(elapsed).toBeLessThan(1500);
    expect(String(res[0].output ?? "")).toMatch(/timed out/i);
  });

  it("does not affect a fast check when the env var is unset", async () => {
    const p = await project("i70-fast");
    delete process.env.CURSOR_GOAL_CHECK_TIMEOUT_MS;
    const res = await runChecks(p.dir, ["true"]);
    expect(res[0].ok).toBe(true);
  });
});

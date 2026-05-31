import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { execMinimalStop } from "../hooks/exec-hook.js";
import { runStopVerifier } from "../../src/lib/verify.js";

describe("I01 empty checks no RELEASE", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("runtime verifier does not release", async () => {
    const p = await mkGitProject("i01");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n\n## Forbidden proxies\n",
      "utf8",
    );
    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).not.toBe("release");
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(false);
  });

  it("minimal stop hook does not release", async () => {
    const p = await mkGitProject("i01-core");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n\n",
      "utf8",
    );
    const r = execMinimalStop(p.dir, { status: "completed", loop_count: 0 });
    expect(r.stdout.followup_message).toBeTruthy();
    await expect(access(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).rejects.toThrow();
  });
});

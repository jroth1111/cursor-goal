import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { runChecks } from "../../src/lib/run-checks.js";
import { execMinimalStop } from "../hooks/exec-hook.js";
import { seedReleaseReady } from "../helpers/release-ready.js";

describe("I167 destructive stop checks", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    restore = undefined;
    cleanup = undefined;
  });

  async function project(name: string): Promise<{ dir: string }> {
    const p = await mkGitProject(name);
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    return p;
  }

  const destructiveCheck = "touch .cursor/goal/evidence/destructive-check-ran; drop database prod";

  it("runtime check execution blocks destructive patterns before side effects", async () => {
    const p = await project("i167-runtime");
    const marker = path.join(p.dir, ".cursor/goal/evidence/destructive-check-ran");

    const res = await runChecks(p.dir, [destructiveCheck]);

    expect(res[0].ok).toBe(false);
    expect(String(res[0].output ?? "")).toMatch(/destructive/i);
    expect(existsSync(marker)).toBe(false);
  });

  it("minimal stop verifier blocks destructive checks before side effects", async () => {
    const p = await project("i167-minimal");
    const marker = path.join(p.dir, ".cursor/goal/evidence/destructive-check-ran");
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal\nx\n## Checks\n- \`${destructiveCheck}\`\n`,
      "utf8",
    );
    await seedReleaseReady(p.dir);

    const r = execMinimalStop(
      p.dir,
      { status: "completed", loop_count: 0 },
      { CURSOR_GOAL_STOP_FOLLOWUP: "1" },
    );

    expect(String(r.stdout.followup_message ?? "")).toMatch(/destructive/i);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(false);
  });
});

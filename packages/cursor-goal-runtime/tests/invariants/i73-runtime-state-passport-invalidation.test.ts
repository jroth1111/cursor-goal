import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { seedReleaseReady } from "../helpers/release-ready.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { passportsDir, writeJson } from "../../src/lib/paths.js";
import { runStopVerifier } from "../../src/lib/verify.js";

describe("I73 runtime-state passport invalidation", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    restore = undefined;
    cleanup = undefined;
  });

  it("compile invalidation removes stale RELEASE and SESSION_END passports", async () => {
    const p = await mkGitProject("i73-compile-passports");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nship v1\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);

    const release = await runStopVerifier({
      status: "completed",
      loop_count: 0,
      conversation_id: "agent-a",
    });
    expect(release.kind).toBe("release");
    expect(existsSync(path.join(passportsDir(p.dir), "RELEASE.json"))).toBe(true);

    await writeJson(path.join(passportsDir(p.dir), "SESSION_END.json"), {
      status: "SESSION_END",
      reason: "old-session",
    });

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nship v2\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);

    expect(existsSync(path.join(passportsDir(p.dir), "RELEASE.json"))).toBe(false);
    expect(existsSync(path.join(passportsDir(p.dir), "SESSION_END.json"))).toBe(false);
  });
});

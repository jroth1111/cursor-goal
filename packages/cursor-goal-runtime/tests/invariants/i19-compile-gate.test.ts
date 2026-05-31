import { describe, it, expect, afterEach } from "vitest";
import { writeFile, utimes } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { isGoalStale } from "../../src/lib/compile-stale.js";

describe("I19 compile gate", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("detects stale GOAL.md after compile", async () => {
    const p = await mkGitProject("i19");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    expect(await isGoalStale(p.dir)).toBe(false);
    const now = Date.now() / 1000 + 60;
    await utimes(path.join(p.dir, "GOAL.md"), now, now);
    expect(await isGoalStale(p.dir)).toBe(true);
  });
});

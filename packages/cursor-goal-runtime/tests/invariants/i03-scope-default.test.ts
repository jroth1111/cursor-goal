import { describe, it, expect, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoal } from "../../src/lib/compile-goal.js";

describe("I03 scope default", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("compile sets enforce false when no scope paths", async () => {
    const p = await mkGitProject("i03");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoal();
    const scope = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/scope.json"), "utf8"),
    );
    expect(scope.enforce).toBe(false);
    expect(scope.paths).toEqual([]);
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";

describe("I14 work-units when scope non-empty", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("auto-slices units from scope", async () => {
    const p = await mkGitProject("i14");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Scope\n- `lib/`\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    const { readFile } = await import("node:fs/promises");
    const wu = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/work-units.json"), "utf8"),
    );
    expect(wu.units.length).toBeGreaterThanOrEqual(1);
  });

  it("auto-slices dot scope to a non-empty root unit id", async () => {
    const p = await mkGitProject("i14-dot");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Scope\n- `.`\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    const { readFile } = await import("node:fs/promises");
    const wu = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/work-units.json"), "utf8"),
    );
    expect(wu.units[0]?.id).toBe("root");
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "./helpers/git-fixture.js";
import { compileGoalV2 } from "../src/compile/compile-v2.js";
import { parseGoalMd, autoSliceWorkUnits } from "../src/lib/parse-goal-md.js";

describe("compile v2", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("rejects invalid compile when schema fails", async () => {
    const p = await mkGitProject("compile-bad");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\n\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    const { readFile } = await import("node:fs/promises");
    const manifest = await readFile(path.join(p.dir, ".cursor/goal/manifest.json"), "utf8");
    expect(manifest).toContain("goal_id");
  });

  it("explicit work units beat auto-slice", async () => {
    const p = await mkGitProject("compile-wu");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    process.env.CURSOR_PROJECT_DIR = p.dir;
    const md = `## Goal
x
## Scope
- \`src/a/\`
- \`src/b/\`
## Work units
### only-one
Single unit
- \`src/a/\`
## Checks
- \`true\`
`;
    await writeFile(path.join(p.dir, "GOAL.md"), md, "utf8");
    const parsed = await parseGoalMd(p.dir);
    expect(parsed.workUnits).toHaveLength(1);
    expect(parsed.workUnits[0].id).toBe("only-one");
    expect(autoSliceWorkUnits(["src/x/"], ["true"])).toHaveLength(1);
  });
});

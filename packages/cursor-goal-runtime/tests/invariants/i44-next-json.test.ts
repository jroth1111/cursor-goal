import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { seedReleaseReady } from "../helpers/release-ready.js";

describe("I44 cursor-goal next --json", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("emits JSON snapshot with blocked state and next_action", async () => {
    const p = await mkGitProject("i44");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### mod-a
A
- \`pkg/a/\`
## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "next", "--json"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);
    const snap = JSON.parse(r.stdout);
    expect(typeof snap.blocked).toBe("boolean");
    expect(snap.blocked).toBe(true);
    expect(snap.next_action?.kind).toBe("dispatch_unit");
    expect(Array.isArray(snap.blockers)).toBe(true);
    expect(snap.dispatch_head?.unit_id).toBe("mod-a");
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { markUnitDoneWithEvidence } from "../helpers/release-ready.js";

describe("I17 parent RELEASE requires units done", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("blocks release until all work units done", async () => {
    const p = await mkGitProject("i17");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Scope\n- `src/`\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeFile(
      path.join(p.dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase: "VERIFY" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/discovery.json"),
      JSON.stringify({ completed: true, notes: "ok" }),
      "utf8",
    );

    const blocked = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(blocked.kind).toBe("continue");

    const wu = JSON.parse(
      await (await import("node:fs/promises")).readFile(
        path.join(p.dir, ".cursor/goal/work-units.json"),
        "utf8",
      ),
    );
    for (const u of wu.units) await markUnitDoneWithEvidence(u.id, p.dir);

    const released = await runStopVerifier({ status: "completed", loop_count: 1 });
    expect(released.kind).toBe("release");
  });
});

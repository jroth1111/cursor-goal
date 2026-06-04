import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { seedReleaseReady } from "../helpers/release-ready.js";
import { gitTreeId, readState } from "../../src/lib/git-state.js";

describe("I238 proof sync on passing scheduled checks", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;
  const prevProfile = process.env.CURSOR_GOAL_STOP_CHECK_PROFILE;

  afterEach(async () => {
    if (prevProfile === undefined) delete process.env.CURSOR_GOAL_STOP_CHECK_PROFILE;
    else process.env.CURSOR_GOAL_STOP_CHECK_PROFILE = prevProfile;
    restore?.();
    await cleanup?.();
  });

  it("updates last_proof_tree when full-tier checks pass after edits", async () => {
    const p = await mkGitProject("i238-sync");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nlong enough goal text\n## Checks\n- `true`\n",
      "utf8",
    );
    await seedReleaseReady(p.dir);

    const first = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(first.kind).toBe("release");

    await writeFile(path.join(p.dir, "edited.txt"), "x", "utf8");
    const treeBefore = gitTreeId(p.dir);

    process.env.CURSOR_GOAL_STOP_CHECK_PROFILE = "all";
    const second = await runStopVerifier({ status: "completed", loop_count: 2 });
    expect(second.kind).toBe("release");

    const state = await readState(p.dir);
    expect(state.last_proof_tree).toBe(treeBefore);
    if (second.kind === "continue") {
      expect(second.message).not.toMatch(/edits since last proof/i);
    }
  });
});

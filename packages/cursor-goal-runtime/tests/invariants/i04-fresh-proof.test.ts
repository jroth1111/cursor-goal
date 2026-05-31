import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { seedReleaseReady } from "../helpers/release-ready.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { markEdit } from "../../src/lib/git-state.js";

describe("I04 fresh proof", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("releases after edit when checks pass again", async () => {
    const p = await mkGitProject("i04");
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

    await markEdit(p.dir);
    await writeFile(path.join(p.dir, "edited.txt"), "x", "utf8");

    const second = await runStopVerifier({ status: "completed", loop_count: 1 });
    expect(second.kind).toBe("release");
  });
});

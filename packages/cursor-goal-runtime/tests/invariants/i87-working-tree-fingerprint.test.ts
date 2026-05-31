import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { seedReleaseReady } from "../helpers/release-ready.js";
import { workingTreeFingerprint } from "../../src/lib/git-state.js";

describe("I87 content-addressed working tree fingerprint", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("changes fingerprint when dirty tracked file content changes", async () => {
    const p = await mkGitProject("i87-fp");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "mut.txt"), "v1\n", "utf8");
    const before = workingTreeFingerprint(p.dir);
    await writeFile(path.join(p.dir, "mut.txt"), "v2\n", "utf8");
    const after = workingTreeFingerprint(p.dir);
    expect(before).not.toBe(after);
  });

  it("blocks release when a check mutates already-dirty tracked content", async () => {
    const p = await mkGitProject("i87-stale");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "mut.txt"), "seed\n", "utf8");
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `echo mutated >> mut.txt`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).toBe("continue");
    if (r.kind === "continue") {
      expect(r.message).toMatch(/stale-proof/i);
    }
  });
});

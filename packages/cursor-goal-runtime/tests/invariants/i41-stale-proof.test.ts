import { describe, it, expect, afterEach, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { seedReleaseReady } from "../helpers/release-ready.js";
import * as gitState from "../../src/lib/git-state.js";

describe("I41 stale-proof blocks release on tree drift during verify", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    vi.restoreAllMocks();
    restore?.();
    await cleanup?.();
  });

  it("adds stale-proof failure when tree changes during pipeline", async () => {
    const p = await mkGitProject("i41");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await seedReleaseReady(p.dir);

    let calls = 0;
    const spy = vi.spyOn(gitState, "gitTreeId").mockImplementation(() => {
      calls += 1;
      return calls === 1 ? "tree-at-start" : "tree-at-end";
    });

    try {
      const r = await runStopVerifier({ status: "completed", loop_count: 0 });
      expect(r.kind).toBe("continue");
      if (r.kind === "continue") {
        expect(r.message).toMatch(/stale-proof/i);
      }
    } finally {
      spy.mockRestore();
    }
  });
});

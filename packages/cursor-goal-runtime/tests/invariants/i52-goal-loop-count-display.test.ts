import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { readAgentRuntimeState } from "../../src/lib/agent-runtime-state.js";
import { seedReleaseReady } from "../helpers/release-ready.js";

describe("I52 goal loop count display", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("increments GOAL loop display when Cursor stop index is stuck", async () => {
    const p = await mkGitProject("i52");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/manifest.json"),
      JSON.stringify({ loop_limit: 40 }),
      "utf8",
    );
    await seedReleaseReady(p.dir);

    const cursorStuck = 25;
    for (let expected = 1; expected <= 3; expected++) {
      const r = await runStopVerifier({
        status: "completed",
        loop_count: cursorStuck,
      });
      expect(r.kind).toBe("continue");
      if (r.kind !== "continue") continue;
      expect(r.message).toContain(`GOAL loop ${expected}/40`);
      expect(r.message).toContain("(agent stop 25/40)");
      const state = await readAgentRuntimeState(p.dir, "default");
      expect(state?.loop_count).toBe(expected);
    }
  });
});

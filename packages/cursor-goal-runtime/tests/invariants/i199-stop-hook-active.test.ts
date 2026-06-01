import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { runStopPipeline } from "../../src/verifier/pipeline.js";

describe("I199 stop_hook_active suppresses followup", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("returns idle when stop_hook_active and checks still fail", async () => {
    const p = await mkGitProject("i199");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    const result = await runStopPipeline(
      { status: "completed", stop_hook_active: true },
      { dryRun: false },
    );
    expect(result.kind).toBe("idle");
  }, 20000);
});

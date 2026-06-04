import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { execMinimalStop } from "../hooks/exec-hook.js";
import { runStopVerifier } from "../../src/lib/verify.js";

describe("I07 stop followup on failing checks", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("runtime returns continue with message", async () => {
    const p = await mkGitProject("i07");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).toBe("continue");
  });

  it("minimal hook returns followup_message", async () => {
    const p = await mkGitProject("i07b");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    const r = execMinimalStop(
      p.dir,
      { status: "completed", loop_count: 0 },
      { CURSOR_GOAL_STOP_FOLLOWUP: "1" },
    );
    expect(r.stdout.followup_message).toBeTruthy();
  });
});

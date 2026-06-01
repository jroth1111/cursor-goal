import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { writeSessionMode } from "../../src/lib/governance-config.js";
import { isGovernanceActive } from "../../src/lib/governance-active.js";
import { appendTriageLog } from "../../src/lib/prompt-triage.js";

describe("I213 governance active after /goal triage", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("isGovernanceActive true when last triage forceGoverned despite session chat", async () => {
    const p = await mkGitProject("i202-force-goal-active");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeSessionMode(p.dir, "chat", "cli");

    await appendTriageLog(p.dir, "/goal run delivery", "governed", "conv-a");

    expect(await isGovernanceActive(p.dir, "conv-a")).toBe(true);
    expect(await isGovernanceActive(p.dir, "other-conv")).toBe(false);
  });
});

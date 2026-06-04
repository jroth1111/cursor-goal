import { describe, it, expect, afterEach } from "vitest";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { writeSessionMode } from "../../src/lib/governance-config.js";
import { resolveEffectiveMode } from "../../src/lib/prompt-triage.js";
import { formatNextAction } from "../../src/lib/next-action.js";

describe("I244 today transcript incident corpus", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("/goal /autoreview using cursor is governed even when the session was chat-pinned", async () => {
    const p = await mkGitProject("i244-goal-autoreview");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeSessionMode(p.dir, "chat", "cli");

    const mode = await resolveEffectiveMode(
      p.dir,
      "/goal /autoreview using cursor",
      "today-autoreview",
    );

    expect(mode.mode).toBe("governed");
    expect(mode.triageReasons).toContain("explicit_governed");
  });

  it("incident followups are redacted by default; operator output requires explicit prompt opt-in", () => {
    const action = {
      kind: "dispatch_unit" as const,
      headline: 'Dispatch work unit "har-recover-tools"',
      detail: "Run: cursor-goal dispatch --run, or inspect the full task prompt with cursor-goal next.",
      taskPrompt: "work_unit_id: har-recover-tools\nComplete work unit",
    };

    const stopFollowup = formatNextAction(action);
    expect(stopFollowup).not.toMatch(/Task prompt:|work_unit_id:/);

    const operatorNext = formatNextAction(action, { includeTaskPrompt: true });
    expect(operatorNext).toMatch(/Task prompt:/);
    expect(operatorNext).toMatch(/work_unit_id: har-recover-tools/);
  });
});

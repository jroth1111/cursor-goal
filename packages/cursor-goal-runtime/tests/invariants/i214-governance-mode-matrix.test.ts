import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { writeSessionMode } from "../../src/lib/governance-config.js";
import { resolveEffectiveMode } from "../../src/lib/prompt-triage.js";

/**
 * Governance mode matrix (see RUNBOOK.md):
 * | Session | /goal        | Blocked | Effective mode |
 * | chat    | yes → governed | yes → governed | governed |
 * | chat    | no           | no      | chat       |
 * | governed| *            | *       | governed   |
 */
describe("I214 governance mode matrix", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("chat session + /goal → governed", async () => {
    const p = await mkGitProject("i203-matrix-goal");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeSessionMode(p.dir, "chat", "cli");
    const r = await resolveEffectiveMode(p.dir, "/goal ship it", "a");
    expect(r.mode).toBe("governed");
    expect(r.triageReasons).toContain("explicit_governed");
  });

  it("chat session + Q&A → chat", async () => {
    const p = await mkGitProject("i203-matrix-qa");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeSessionMode(p.dir, "chat", "cli");
    const r = await resolveEffectiveMode(p.dir, "How does this function work?", "a");
    expect(r.mode).toBe("chat");
  });

  it("governed session stays governed", async () => {
    const p = await mkGitProject("i203-matrix-gov");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeSessionMode(p.dir, "governed", "cli");
    const r = await resolveEffectiveMode(p.dir, "continue", "a");
    expect(r.mode).toBe("governed");
  });

  it("auto default + delivery + GOAL checks → nudge without contract takeover", async () => {
    const p = await mkGitProject("i203-matrix-auto-delivery");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    const r = await resolveEffectiveMode(
      p.dir,
      "Implement auth middleware and make tests pass",
      "a",
    );
    expect(r.mode).toBe("nudge");
    expect(r.nudgeKind).toBe("delivery");
    expect(r.triageReasons ?? []).not.toContain("governed_contract_present");
  });

  it("auto default + read-only prompt + GOAL checks → chat", async () => {
    const p = await mkGitProject("i203-matrix-auto-readonly");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );

    const r = await resolveEffectiveMode(
      p.dir,
      "Review only: explain the current design without editing",
      "a",
    );
    expect(r.mode).toBe("chat");
    expect(r.interactionModeHint).toBe("chat");
  });
});

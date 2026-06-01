import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { writeSessionMode } from "../../src/lib/governance-config.js";
import { appendTriageLog } from "../../src/lib/prompt-triage.js";
import { auditGovernanceMismatch } from "../../src/lib/governance-doctor.js";
import { atomicWriteJson } from "../../src/lib/paths.js";

describe("I215 doctor governance mismatch warnings", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("warns when session chat and last triage forceGoverned", async () => {
    const p = await mkGitProject("i215-chat-force");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeSessionMode(p.dir, "chat", "cli");
    await appendTriageLog(p.dir, "/goal work", "governed");

    const issues = await auditGovernanceMismatch(p.dir);
    expect(issues.some((i) => i.message.includes("forceGoverned"))).toBe(true);
  });

  it("warns when intent checks drift from checks.json", async () => {
    const p = await mkGitProject("i215-intent-drift");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await atomicWriteJson(path.join(p.dir, ".cursor/goal/intent.json"), {
      goal: "x",
      checks: ["false"],
    });

    const issues = await auditGovernanceMismatch(p.dir);
    expect(issues.some((i) => i.message.includes("intent.json"))).toBe(true);
  });

  it("warns when stop timeout low and npm test in checks", async () => {
    const p = await mkGitProject("i215-stop-timeout");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- npm test\n",
      "utf8",
    );
    await atomicWriteJson(path.join(p.dir, ".cursor/goal/checks.json"), {
      commands: ["npm test"],
    });
    await writeFile(
      path.join(p.dir, ".cursor/hooks.json"),
      JSON.stringify({
        version: 1,
        hooks: { stop: [{ command: "hooks/goal-stop.sh", timeout: 120 }] },
      }),
      "utf8",
    );

    const issues = await auditGovernanceMismatch(p.dir);
    expect(issues.some((i) => i.message.includes("stop.timeout"))).toBe(true);
  });
});

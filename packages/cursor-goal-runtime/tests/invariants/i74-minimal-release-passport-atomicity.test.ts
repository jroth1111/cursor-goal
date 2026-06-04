import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { readJson } from "../../src/lib/paths.js";
import { readAgentRuntimeState, writeAgentRuntimeState } from "../../src/lib/agent-runtime-state.js";
import { execMinimalStop } from "../hooks/exec-hook.js";

describe("I74 minimal fallback release authority", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    restore = undefined;
    cleanup = undefined;
  });

  it("does not ship a minimal fallback release writer", async () => {
    const script = await readFile(
      path.resolve(import.meta.dirname, "../../../../core/.cursor/hooks/verify-minimal.sh"),
      "utf8",
    );
    expect(script).not.toMatch(/\brelease_all_locked\b/);
    expect(script).not.toMatch(/\bwrite_release_passport\b/);
    expect(script).not.toMatch(/status:\s*"RELEASE"/);
  });

  it("does not attempt RELEASE reset when checks pass but runtime authority is unavailable", async () => {
    const p = await mkGitProject("i74-no-release-reset");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await mkdir(path.join(p.dir, ".cursor/goal/runtime-state.json"), { recursive: true });

    const r = execMinimalStop(p.dir, {
      status: "completed",
      loop_count: 0,
      conversation_id: "agent-a",
    });

    expect(r.exitCode).toBe(0);
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(false);
    expect(existsSync(path.join(p.dir, ".cursor/goal/.lock"))).toBe(false);
  });

  it("keeps blocked state and does not write RELEASE.json when checks pass", async () => {
    const p = await mkGitProject("i74-no-release-loop-zero");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await writeAgentRuntimeState(p.dir, "agent-a", {
      mode: "minimal",
      loop_count: 5,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: true,
      blockers: ["old"],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });

    const r = execMinimalStop(
      p.dir,
      {
        status: "completed",
        loop_count: 0,
        conversation_id: "agent-a",
      },
      { CURSOR_GOAL_STOP_FOLLOWUP: "1" },
    );

    expect(r.exitCode).toBe(0);
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(false);
    expect(String(r.stdout.followup_message ?? "")).toMatch(/runtime authority|release requires/i);
    const state = await readAgentRuntimeState(p.dir, "agent-a");
    expect(state?.blocked).toBe(true);
    expect(state?.loop_count).toBe(5);
  });

  it("writes valid JSON disposition for raw conversation ids", async () => {
    const p = await mkGitProject("i74-json-conversation");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/manifest.json"),
      JSON.stringify({ loop_limit: 3 }),
      "utf8",
    );

    const r = execMinimalStop(p.dir, {
      status: "completed",
      loop_count: 1,
      conversation_id: 'agent"bad',
    });

    expect(r.exitCode).toBe(0);
    const disposition = await readJson<{ conversation_id?: string }>(
      path.join(p.dir, ".cursor/goal/agents/agent_bad/DISPOSITION.json"),
    );
    expect(disposition?.conversation_id).toBe('agent"bad');
  });
});

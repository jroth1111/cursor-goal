import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { writeAgentRuntimeState } from "../../src/lib/agent-runtime-state.js";
import { isGovernanceActive } from "../../src/lib/governance-active.js";

describe("I168 default chat mode prompt governance", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    restore = undefined;
    cleanup = undefined;
  });

  function runBeforeSubmit(
    dir: string,
    prompt: string,
    conversationId = "chat-agent",
  ): ReturnType<typeof spawnSync> {
    const hook = path.resolve(import.meta.dirname, "../../dist/hook-beforeSubmitPrompt.mjs");
    return spawnSync("node", [hook], {
      cwd: dir,
      input: JSON.stringify({ prompt, conversation_id: conversationId }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: dir },
    });
  }

  it("honors default_mode chat even when GOAL.md has checks", async () => {
    const p = await mkGitProject("i168-default-chat-goal");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/config.json"),
      JSON.stringify({ default_mode: "chat" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );

    const r = runBeforeSubmit(p.dir, "explain this file");
    expect(r.status, r.stderr || r.stdout).toBe(0);
    const out = JSON.parse((r.stdout ?? "{}").trim());
    expect(out.continue).toBe(true);
    expect(out.agent_message).toBeUndefined();
    expect(existsSync(path.join(p.dir, ".cursor/goal/work-units.json"))).toBe(false);
    expect(existsSync(path.join(p.dir, ".cursor/goal/manifest.json"))).toBe(false);
  });

  it("still warns for a blocked conversation under default_mode chat", async () => {
    const p = await mkGitProject("i168-default-chat-blocked");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/config.json"),
      JSON.stringify({ default_mode: "chat" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeAgentRuntimeState(p.dir, "chat-agent", {
      mode: "runtime",
      loop_count: 1,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: true,
      blockers: ["check failed"],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });

    const r = runBeforeSubmit(p.dir, "explain this file");
    expect(r.status, r.stderr || r.stdout).toBe(0);
    const out = JSON.parse((r.stdout ?? "{}").trim());
    expect(out.continue).toBe(true);
    expect(out.agent_message).toBeUndefined();
    expect(out.user_message).toBeUndefined();
  });

  it("keeps stop governance active only for blocked agents under default_mode chat", async () => {
    const p = await mkGitProject("i168-default-chat-active");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/config.json"),
      JSON.stringify({ default_mode: "chat" }),
      "utf8",
    );
    await writeAgentRuntimeState(p.dir, "blocked-agent", {
      mode: "runtime",
      loop_count: 1,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: true,
      blockers: ["check failed"],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });

    expect(await isGovernanceActive(p.dir, "blocked-agent")).toBe(true);
    expect(await isGovernanceActive(p.dir, "other-agent")).toBe(false);
  });
});

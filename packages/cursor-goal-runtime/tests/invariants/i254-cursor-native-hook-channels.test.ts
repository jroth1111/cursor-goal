import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";

function runHook(root: string, hookName: string, input: unknown): Record<string, unknown> {
  const hook = path.resolve(import.meta.dirname, `../../dist/hook-${hookName}.mjs`);
  const r = spawnSync("node", [hook], {
    cwd: root,
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CURSOR_PROJECT_DIR: root },
  });
  expect(r.status, `${hookName} stderr: ${r.stderr}`).toBe(0);
  return JSON.parse((r.stdout ?? "{}").trim() || "{}") as Record<string, unknown>;
}

describe("I254 Cursor-native hook channels", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("sessionStart puts steady-state goal context in additional_context", async () => {
    const p = await mkGitProject("i254-session-start");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nShip hook channels\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeFile(
      path.join(p.dir, ".cursor/goal/config.json"),
      JSON.stringify({ default_mode: "governed" }),
      "utf8",
    );

    const out = runHook(p.dir, "sessionStart", { conversation_id: "conv-a" });
    expect(out.agent_message).toBeUndefined();
    expect(String(out.additional_context ?? "")).toContain("cursor-goal");
    expect(String(out.additional_context ?? "")).toContain("loop=");
  });

  it("beforeSubmitPrompt advisories do not rely on ignored agent_message", async () => {
    const p = await mkGitProject("i254-before-submit");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const out = runHook(p.dir, "beforeSubmitPrompt", {
      conversation_id: "conv-a",
      prompt: "explain what this repo does",
    });
    expect(out.continue).toBe(true);
    expect(out.agent_message).toBeUndefined();
    expect(out.user_message).toBeUndefined();
  });

  it("preCompact uses user_message because Cursor does not consume additional_context there", async () => {
    const p = await mkGitProject("i254-precompact");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "GOAL.md"), "## Goal\nx\n## Checks\n- `false`\n", "utf8");
    const agentDir = path.join(p.dir, ".cursor/goal/agents/conv-a");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      path.join(agentDir, "runtime-state.json"),
      JSON.stringify({
        mode: "runtime",
        blocked: true,
        blockers: ["false"],
        next_action: { kind: "fix_checks", headline: "Fix checks", detail: "false" },
        loop_count: 1,
        loop_limit: 40,
        phase: "VERIFY",
        last_check_fail: { cmd: "false", output: "failed", at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );

    const out = runHook(p.dir, "preCompact", { conversation_id: "conv-a" });
    expect(out.additional_context).toBeUndefined();
    expect(String(out.user_message ?? "")).toContain("cursor-goal compaction snapshot");
  });
});

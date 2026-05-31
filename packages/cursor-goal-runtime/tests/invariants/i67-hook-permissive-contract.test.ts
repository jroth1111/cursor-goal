import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import {
  execCoreHook,
  execCoreHookWithMinimalEnv,
} from "../hooks/exec-hook.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { writeAgentRuntimeState } from "../../src/lib/agent-runtime-state.js";

describe("I67 hook permissiveness contract", { timeout: 30_000 }, () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function governedProject(name: string): Promise<{ dir: string; cleanup: () => Promise<void> }> {
    const p = await mkGitProject(name);
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, "src"), { recursive: true });
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Scope
- \`src/\`
## Work units

### unit-a
Unit A
- \`src/\`

## Checks
- \`false\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    return p;
  }

  it("primary-agent Shell, Write, and Task hooks are not manual approval walls", async () => {
    const p = await governedProject("i67-primary");

    const shell = execCoreHook(p.dir, "beforeShellExecution", {
      command: `cd ${JSON.stringify(p.dir)} && python3 - <<'PY'\nprint('ok')\nPY`,
    });
    expect(shell.stdout.permission).toBe("allow");

    const write = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: "outside-goal-scope.ts",
    });
    expect(write.stdout.permission).toBe("allow");

    const edit = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Edit",
      file_path: "outside-goal-scope.ts",
    });
    expect(edit.stdout.permission).toBe("allow");

    const task = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Task",
      tool_input: { prompt: "run the relevant checks and report failures" },
    });
    expect(task.stdout.permission).toBe("allow");
  });

  it("keeps narrow hard denials for destructive shell and subagent governance writes", async () => {
    const p = await governedProject("i67-deny");

    const shell = execCoreHook(p.dir, "beforeShellExecution", {
      command: "rm -rf /tmp/cursor-goal-nope",
    });
    expect(shell.stdout.permission).toBe("deny");
    expect(String(shell.stdout.agent_message ?? "")).toMatch(/destructive/i);

    const subagent = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: ".cursor/goal/manifest.json",
      is_subagent: true,
      work_unit_id: "unit-a",
    });
    expect(subagent.stdout.permission).toBe("deny");
    expect(String(subagent.stdout.agent_message ?? "")).toMatch(/Subagents/i);
  });

  it("does not let chat passthrough bypass subagent isolation", async () => {
    const p = await governedProject("i67-subagent-passthrough");
    await writeFile(
      path.join(p.dir, ".cursor/goal/config.json"),
      JSON.stringify({ default_mode: "chat" }),
      "utf8",
    );

    const governanceWrite = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: ".cursor/goal/manifest.json",
      is_subagent: true,
      work_unit_id: "unit-a",
    });
    expect(governanceWrite.stdout.permission).toBe("deny");

    const scopedWrite = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: "outside-goal-scope.ts",
      is_subagent: true,
      work_unit_id: "unit-a",
    });
    expect(scopedWrite.stdout.permission).toBe("deny");

  });

  it("beforeSubmitPrompt warns but does not block on blocked runtime state or PAUSED", async () => {
    const p = await governedProject("i67-submit");
    await writeAgentRuntimeState(p.dir, "default", {
      mode: "runtime",
      loop_count: 1,
      loop_limit: 40,
      phase: "PROOF",
      blocked: true,
      blockers: ["check failed"],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });

    const blocked = execCoreHook(p.dir, "beforeSubmitPrompt", {
      prompt: "fix the broken implementation",
      conversation_id: "default",
    });
    expect(blocked.stdout.continue).toBe(true);
    expect(String(blocked.stdout.agent_message ?? "")).toMatch(/blocked|runtime-state/i);

    await writeFile(path.join(p.dir, ".cursor/goal/PAUSED"), "", "utf8");
    const paused = execCoreHook(p.dir, "beforeSubmitPrompt", {
      prompt: "fix the broken implementation",
      conversation_id: "default",
    });
    expect(paused.stdout.continue).toBe(true);
    expect(String(paused.stdout.agent_message ?? "")).toMatch(/paused/i);
  });

  it("beforeSubmitPrompt and sessionStart fail open on malformed governance state", async () => {
    const p = await governedProject("i67-malformed-state");
    await writeFile(path.join(p.dir, ".cursor/goal/config.json"), "{", "utf8");

    const prompt = execCoreHook(p.dir, "beforeSubmitPrompt", {
      prompt: "implement the fix",
      conversation_id: "default",
    });
    expect(prompt.exitCode).toBe(0);
    expect(prompt.stdout.continue).toBe(true);
    expect(String(prompt.stdout.agent_message ?? "")).toMatch(/continuing fail-open|warning/i);

    const session = execCoreHook(p.dir, "sessionStart", {
      conversation_id: "default",
    });
    expect(session.exitCode).toBe(0);
    expect(String(session.stdout.agent_message ?? "")).toMatch(/continuing fail-open|cursor-goal/i);
  });

  it("minimal fallback is also fail-open for primary-agent work", async () => {
    const p = await governedProject("i67-minimal");
    await writeFile(path.join(p.dir, ".cursor/goal/PAUSED"), "", "utf8");

    const submit = execCoreHookWithMinimalEnv(p.dir, "beforeSubmitPrompt", {
      prompt: "continue",
    });
    expect(submit.stdout.continue).toBe(true);

    const write = execCoreHookWithMinimalEnv(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: "outside-goal-scope.ts",
    });
    expect(write.stdout.permission).toBe("allow");

    const shell = execCoreHookWithMinimalEnv(p.dir, "preToolUse", {
      tool_name: "Shell",
      command: "rm -rf /tmp/cursor-goal-nope",
    });
    expect(shell.stdout.permission).toBe("deny");
  });

  it("postToolUse creates unit evidence directories instead of crashing", async () => {
    const p = await governedProject("i67-post-tool-units");
    rmSync(path.join(p.dir, ".cursor/goal/evidence/units"), { recursive: true, force: true });
    const hook = path.resolve(import.meta.dirname, "../../dist/hook-postToolUse.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        tool_name: "Shell",
        tool_input: { prompt: "work_unit_id: unit-a" },
        tool_output: "ok",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);
    expect(JSON.parse((r.stdout ?? "{}").trim() || "{}")).toEqual({});
  });

});

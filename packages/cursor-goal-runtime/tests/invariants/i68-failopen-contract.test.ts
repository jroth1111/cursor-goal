import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { execCoreHook, execCoreHookBare } from "../hooks/exec-hook.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";

/**
 * I68 - "govern completion, not execution" fail-open contract.
 *
 * One consolidated proof of the eight behaviours the contract requires.
 * Primary-agent Shell / Write / Edit / Task must fail open; only destructive
 * shell and subagent isolation may hard-deny; runtime-missing must not block
 * or crash. Complements i67 / i38 / i24 / i02.
 */
describe("I68 fail-open contract", { timeout: 30_000 }, () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    restore = undefined;
    cleanup = undefined;
  });

  async function governed(name: string, goalBody?: string): Promise<{ dir: string }> {
    const p = await mkGitProject(name);
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      goalBody ?? "## Goal\nx\n## Scope\n- `src/`\n## Checks\n- `false`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    return p;
  }

  it("1: normal wrapped shell commands are allowed", async () => {
    const p = await governed("i68-shell");
    const commands = [
      "bash -lc 'pytest -q'",
      'cd "$PWD" && npm run build',
      "sh -c 'ls -la && echo done'",
      "node --version",
    ];
    for (const command of commands) {
      const shell = execCoreHook(p.dir, "beforeShellExecution", { command });
      expect(shell.stdout.permission).toBe("allow");
      const pre = execCoreHook(p.dir, "preToolUse", { tool_name: "Shell", command });
      expect(pre.stdout.permission).toBe("allow");
    }
  }, 15000);

  it("2: primary Write and Edit are allowed even out of scope in a governed project", async () => {
    const p = await governed("i68-write");
    for (const tool_name of ["Write", "Edit"]) {
      const r = execCoreHook(p.dir, "preToolUse", {
        tool_name,
        file_path: "outside-scope/anything.ts",
      });
      expect(r.stdout.permission).toBe("allow");
    }
  });

  it("3: Task creation without work_unit_id is allowed", async () => {
    const p = await governed("i68-task");
    const r = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Task",
      tool_input: { prompt: "investigate the failing build and report findings" },
    });
    expect(r.stdout.permission).toBe("allow");
  });

  it("4: PAUSED and blocked runtime state warn but do not block prompt submit", async () => {
    const p = await governed("i68-paused");

    // Blocked runtime state, with failing checks recorded by the stop verifier.
    await runStopVerifier({ status: "completed", loop_count: 0 });
    const blocked = execCoreHook(p.dir, "beforeSubmitPrompt", {
      prompt: "implement the fix",
      conversation_id: "default",
    });
    expect(blocked.stdout.continue).toBe(true);

    await writeFile(path.join(p.dir, ".cursor/goal/PAUSED"), "", "utf8");
    const paused = execCoreHook(p.dir, "beforeSubmitPrompt", {
      prompt: "implement the fix",
      conversation_id: "default",
    });
    expect(paused.stdout.continue).toBe(true);
    expect(String(paused.stdout.agent_message ?? "")).toMatch(/paused/i);
  });

  it("5: runtime-missing fallback allows normal primary work", async () => {
    const p = await governed("i68-noruntime");
    const write = execCoreHookBare(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: "src/x.ts",
    });
    expect(write.stdout.permission).toBe("allow");
    expect(String(write.stdout.agent_message ?? "")).toMatch(/runtime not built/i);

    const shell = execCoreHookBare(p.dir, "beforeShellExecution", { command: "npm test" });
    expect(shell.stdout.permission).toBe("allow");

    const submit = execCoreHookBare(p.dir, "beforeSubmitPrompt", { prompt: "go" });
    expect(submit.stdout.continue).toBe(true);
  });

  it("6: destructive shell is still denied", async () => {
    const p = await governed("i68-destructive");
    const commands = [
      "rm -rf /tmp/cursor-goal-nope",
      "git push --force origin main",
      "drop database prod",
    ];
    for (const command of commands) {
      const shell = execCoreHook(p.dir, "beforeShellExecution", { command });
      expect(shell.stdout.permission).toBe("deny");
      const pre = execCoreHook(p.dir, "preToolUse", { tool_name: "Shell", command });
      expect(pre.stdout.permission).toBe("deny");
    }
  });

  it("7: subagent governance and out-of-scope writes are still denied", async () => {
    const p = await governed(
      "i68-subagent",
      `## Goal
Two modules

## Work units

### mod-a
Module A
- \`pkg/a/\`

### mod-b
Module B
- \`pkg/b/\`

## Checks
- \`true\`
`,
    );

    const governance = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: ".cursor/goal/manifest.json",
      is_subagent: true,
      work_unit_id: "mod-a",
    });
    expect(governance.stdout.permission).toBe("deny");
    expect(String(governance.stdout.agent_message ?? "")).toMatch(/subagent/i);

    const outOfScope = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: "pkg/b/outside.ts",
      is_subagent: true,
      work_unit_id: "mod-a",
    });
    expect(outOfScope.stdout.permission).toBe("deny");
    expect(String(outOfScope.stdout.agent_message ?? "")).toMatch(/mod-a|scope/i);
  });
});

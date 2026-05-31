import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { spawnSync } from "node:child_process";
import { checkShellGate, shellCommandAllowed } from "../../src/lib/shell-allow.js";
import { execCoreHook } from "../hooks/exec-hook.js";

describe("I23 shell permissiveness", { timeout: 30_000 }, () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("allows normal shell commands without requiring proof-plan patterns", async () => {
    const p = await mkGitProject("i23");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "package.json"), '{"scripts":{"test":"true"}}\n', "utf8");
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `npm test`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    const hook = path.resolve(import.meta.dirname, "../../dist/hook-preToolUse.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        tool_name: "Shell",
        command: "npm test -- --run",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    const out = JSON.parse((r.stdout ?? "{}").trim() || "{}");
    expect(out.permission).toBe("allow");
  }, 15000);

  it("denies destructive shell variants across runtime and wrapper paths", async () => {
    const p = await mkGitProject("i23-deny-variants");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    for (const command of [
      "rm -fr /tmp/x",
      "rm -r -f /tmp/x",
      "rm --recursive --force /tmp/x",
      "git push -f origin main",
      "git push --force-with-lease origin main",
      "git push origin +main",
      "git push origin +refs/heads/main:refs/heads/main",
    ]) {
      expect(shellCommandAllowed(command), command).toBe(false);
      expect((await checkShellGate(command, p.dir)).allowed, command).toBe(false);
      expect(
        execCoreHook(p.dir, "preToolUse", {
          tool_name: "Shell",
          tool_input: { command },
        }).stdout.permission,
        command,
      ).toBe("deny");
      expect(
        execCoreHook(p.dir, "beforeShellExecution", { command }).stdout.permission,
        command,
      ).toBe("deny");
    }
  }, 15000);
});

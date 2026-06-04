import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I198 preCompact emits user-visible compaction context when blocked", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("includes user_message when agent runtime-state is blocked", async () => {
    const p = await mkGitProject("i198");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "GOAL.md"), "## Goal\nx\n## Checks\n- `true`\n", "utf8");
    const agentDir = path.join(p.dir, ".cursor/goal/agents/default");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      path.join(agentDir, "runtime-state.json"),
      JSON.stringify({
        mode: "runtime",
        blocked: true,
        blockers: ["npm test"],
        next_action: "Run npm test",
        loop_count: 2,
        loop_limit: 40,
        phase: "VERIFY",
        last_check_fail: "npm test",
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );
    const hook = path.resolve(import.meta.dirname, "../../dist/hook-preCompact.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ conversation_id: "default" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    const out = JSON.parse((r.stdout ?? "{}").trim() || "{}") as {
      additional_context?: string;
      user_message?: string;
    };
    expect(out.additional_context).toBeUndefined();
    expect(out.user_message).toContain("cursor-goal compaction snapshot");
    expect(out.user_message).toContain("npm test");
  }, 15000);
});

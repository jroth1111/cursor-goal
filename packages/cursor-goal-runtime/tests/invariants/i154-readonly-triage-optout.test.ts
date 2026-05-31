import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I154 read-only triage opt-out", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("does not nudge explicit read-only review prompts just because they mention a fix", async () => {
    const p = await mkGitProject("i154-readonly-triage");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-beforeSubmitPrompt.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        prompt: "Review only: explain how to fix the failing test without editing.",
        conversation_id: "readonly-review",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    const out = JSON.parse((r.stdout ?? "{}").trim());
    expect(out.continue).toBe(true);
    expect(String(out.agent_message ?? "")).not.toMatch(/cursor-goal init|delivery-style/i);
  });
});

import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { classifyPrompt } from "../../src/lib/prompt-triage.js";

describe("I223 /goal continue playbook", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("classifies /goal continue as forceGoverned", () => {
    const c = classifyPrompt("/goal continue from here with existing artifacts");
    expect(c.forceGoverned).toBe(true);
  });

  it("beforeSubmitPrompt surfaces playbook when GOAL.md missing", async () => {
    const p = await mkGitProject("i223");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const hook = path.resolve(
      import.meta.dirname,
      "../../dist/hook-beforeSubmitPrompt.mjs",
    );
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        prompt: "/goal continue from here",
        conversation_id: "i223-agent",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout || "{}") as { continue?: boolean; user_message?: string };
    expect(out.continue).toBe(false);
    expect(out.user_message ?? "").toMatch(/cursor-goal init/i);
    expect(out.user_message ?? "").toMatch(/discovery complete/i);
  });
});

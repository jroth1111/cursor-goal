import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { classifyPrompt, parseGoalSlashAction } from "../../src/lib/prompt-triage.js";
import { clearPaused, pausedMarkerPath, setPaused } from "../../src/lib/goal-pause.js";

describe("I229 /goal pause and resume", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("parseGoalSlashAction distinguishes pause resume and continue", () => {
    expect(parseGoalSlashAction("/goal pause")).toBe("pause");
    expect(parseGoalSlashAction("/goal resume")).toBe("resume");
    expect(parseGoalSlashAction("/goal continue")).toBe("continue");
    expect(parseGoalSlashAction("/goal improve coverage")).toBe("govern");
    expect(parseGoalSlashAction("Please document /goal pause behavior")).toBe("none");
    expect(parseGoalSlashAction("Example: '/goal resume'")).toBe("none");
    expect(classifyPrompt("/goal continue").forceGoverned).toBe(true);
    expect(classifyPrompt("/goal pause").forceGoverned).toBe(false);
    expect(classifyPrompt("/goal improve coverage").forceGoverned).toBe(true);
    expect(classifyPrompt("Please document /goal continue behavior").forceGoverned).toBe(false);
  });

  function runBeforeSubmit(dir: string, prompt: string) {
    const hook = path.resolve(
      import.meta.dirname,
      "../../dist/hook-beforeSubmitPrompt.mjs",
    );
    return spawnSync("node", [hook], {
      cwd: dir,
      input: JSON.stringify({ prompt, conversation_id: "i229-hook" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: dir },
    });
  }

  it("beforeSubmitPrompt /goal pause creates PAUSED and returns resume hint", async () => {
    const p = await mkGitProject("i229-hook-pause");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "GOAL.md"), "## Goal\nx\n", "utf8");
    const r = runBeforeSubmit(p.dir, "/goal pause");
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout || "{}") as { continue?: boolean; user_message?: string };
    expect(existsSync(pausedMarkerPath(p.dir))).toBe(true);
    expect(out.continue).toBe(false);
    expect(out.user_message ?? "").toMatch(/paused/i);
    expect(out.user_message ?? "").toMatch(/resume/i);
  });

  it("beforeSubmitPrompt /goal resume clears PAUSED", async () => {
    const p = await mkGitProject("i229-hook-resume");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await setPaused(p.dir);
    await writeFile(path.join(p.dir, "GOAL.md"), "## Goal\nx\n", "utf8");
    const r = runBeforeSubmit(p.dir, "/goal resume");
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout || "{}") as { continue?: boolean; user_message?: string };
    expect(existsSync(pausedMarkerPath(p.dir))).toBe(false);
    expect(out.continue).toBe(false);
    expect(out.user_message ?? "").toMatch(/resumed/i);
  });

  it("beforeSubmitPrompt ignores incidental /goal pause text in prose", async () => {
    const p = await mkGitProject("i229-hook-incidental");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "GOAL.md"), "## Goal\nx\n## Checks\n- `true`\n", "utf8");
    const r = runBeforeSubmit(p.dir, "Please explain what /goal pause does in docs");
    expect(r.status).toBe(0);
    expect(existsSync(pausedMarkerPath(p.dir))).toBe(false);
  });

  it("setPaused and clearPaused toggle PAUSED marker", async () => {
    const p = await mkGitProject("i229");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await setPaused(p.dir);
    expect(existsSync(pausedMarkerPath(p.dir))).toBe(true);
    await clearPaused(p.dir);
    expect(existsSync(pausedMarkerPath(p.dir))).toBe(false);
  });
});

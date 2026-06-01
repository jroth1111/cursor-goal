import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { writeSessionMode } from "../../src/lib/governance-config.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { resolveEffectiveMode } from "../../src/lib/prompt-triage.js";

describe("I212 /goal escalates session from chat", () => {
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
    conversationId = "goal-agent",
  ) {
    const hook = path.resolve(
      import.meta.dirname,
      "../../dist/hook-beforeSubmitPrompt.mjs",
    );
    return spawnSync("node", [hook], {
      cwd: dir,
      input: JSON.stringify({ prompt, conversation_id: conversationId }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: dir },
    });
  }

  it("session chat + /goal resolves governed and persists session-mode", async () => {
    const p = await mkGitProject("i201-goal-escalate");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeSessionMode(p.dir, "chat", "cli");

    const mode = await resolveEffectiveMode(
      p.dir,
      "/goal implement the orchestrator plan",
      "goal-agent",
    );
    expect(mode.mode).toBe("governed");

    const r = runBeforeSubmit(p.dir, "/goal implement the orchestrator plan", "goal-agent");
    expect(r.status, r.stderr || r.stdout).toBe(0);

    const sessionRaw = await readFile(
      path.join(p.dir, ".cursor/goal/session-mode.json"),
      "utf8",
    );
    const session = JSON.parse(sessionRaw) as { mode: string; source: string };
    expect(session.mode).toBe("governed");
    expect(session.source).toBe("triage");
  });

  it("after /goal escalation stop returns continue when checks fail", async () => {
    const p = await mkGitProject("i201-stop-continue");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeSessionMode(p.dir, "governed", "triage");

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-beforeSubmitPrompt.mjs");
    spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        prompt: "/goal continue work",
        conversation_id: "goal-agent",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    const stop = await runStopVerifier({
      status: "completed",
      loop_count: 0,
      conversation_id: "goal-agent",
    });
    expect(stop.kind).toBe("continue");
    expect(stop.kind === "continue" && stop.message.length).toBeGreaterThan(0);
  });
});

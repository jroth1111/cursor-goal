import { describe, it, expect, afterEach } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { atomicWriteJson } from "../../src/lib/paths.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { seedReleaseReady } from "../helpers/release-ready.js";
import { writeSessionMode } from "../../src/lib/governance-config.js";
import { execCoreHook } from "../hooks/exec-hook.js";

describe("I51 governance triage", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  function runBeforeSubmit(
    p: { dir: string },
    prompt: string,
    conversationId = "default",
  ) {
    const hook = path.resolve(import.meta.dirname, "../../dist/hook-beforeSubmitPrompt.mjs");
    return spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ prompt, conversation_id: conversationId }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
  }

  it("auto + explain prompt + no GOAL → continue without block", async () => {
    const p = await mkGitProject("i51-chat");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const r = runBeforeSubmit(p, "How does this function work?");
    expect(r.status).toBe(0);
    const out = JSON.parse((r.stdout ?? "{}").trim());
    expect(out.continue).toBe(true);
    expect(out.user_message).toBeUndefined();
  });

  it("auto + implement prompt + no GOAL → nudge with init hint", async () => {
    const p = await mkGitProject("i51-nudge");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const r = runBeforeSubmit(p, "Implement auth middleware and make tests pass");
    const out = JSON.parse((r.stdout ?? "{}").trim());
    expect(out.continue).toBe(true);
    expect(out.agent_message).toBeUndefined();
    expect(out.user_message).toBeUndefined();
    const raw = await readFile(path.join(p.dir, ".cursor/goal/triage-log.jsonl"), "utf8");
    expect(raw).toMatch(/"mode":"nudge"/);
  });

  it("GOAL + checks → governed path warns when runtime blocked", async () => {
    const p = await mkGitProject("i51-gov");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    const stop = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(stop.kind).toBe("continue");

    const r = runBeforeSubmit(p, "explain this");
    const out = JSON.parse((r.stdout ?? "{}").trim());
    expect(out.continue).toBe(true);
    expect(out.agent_message).toBeUndefined();
    expect(out.user_message).toBeUndefined();
  });

  it("coverage phrase + no GOAL → nudge mentions inventory", async () => {
    const p = await mkGitProject("i51-cov");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const r = runBeforeSubmit(p, "Test every page on the site and report failures");
    const out = JSON.parse((r.stdout ?? "{}").trim());
    expect(out.continue).toBe(true);
    expect(out.agent_message).toBeUndefined();
    expect(out.user_message).toBeUndefined();
    const raw = await readFile(path.join(p.dir, ".cursor/goal/triage-log.jsonl"), "utf8");
    expect(raw).toMatch(/"mode":"nudge"/);
  });

  it("PAUSED is advisory and does not block prompt submit", async () => {
    const p = await mkGitProject("i51-pause");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, ".cursor/goal/PAUSED"), "", "utf8");

    const r = runBeforeSubmit(p, "How does this work?");
    const out = JSON.parse((r.stdout ?? "{}").trim());
    expect(out.continue).toBe(true);
    expect(out.agent_message).toBeUndefined();
    expect(out.user_message).toBeUndefined();
  });

  it("session chat + blocked runtime warns without blocking", async () => {
    const p = await mkGitProject("i51-chat-blocked");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await runStopVerifier({ status: "completed", loop_count: 0 });
    await writeSessionMode(p.dir, "chat", "cli");

    const r = runBeforeSubmit(p, "explain this");
    const out = JSON.parse((r.stdout ?? "{}").trim());
    expect(out.continue).toBe(true);
    expect(out.agent_message).toBeUndefined();
    expect(out.user_message).toBeUndefined();
  });

  it("SESSION_END is advisory and does not force governed triage for ordinary prompts", async () => {
    const p = await mkGitProject("i51-session-end-governed");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n## Scope\n- `src/`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeSessionMode(p.dir, "chat", "cli");

    await writeFile(
      path.join(p.dir, ".cursor", "goal", "passports", "SESSION_END.json"),
      JSON.stringify({ status: "SESSION_END", reason: "session_end_without_release" }, null, 2),
      "utf8",
    );

    const r = runBeforeSubmit(p, "How does this work?");
    expect(r.status).toBe(0);

    const triagePath = path.join(p.dir, ".cursor", "goal", "triage-log.jsonl");
    const raw = await readFile(triagePath, "utf8");
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]!) as { mode?: string };
    expect(last.mode).toBe("chat");
  });

  it("SESSION_END does not force governed without a governed contract", async () => {
    const p = await mkGitProject("i51-session-end-no-contract");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeSessionMode(p.dir, "chat", "cli");
    await writeFile(
      path.join(p.dir, ".cursor", "goal", "passports", "SESSION_END.json"),
      JSON.stringify({ status: "SESSION_END", reason: "session_end_without_release", had_governed_contract: false }, null, 2),
      "utf8",
    );

    const r = runBeforeSubmit(p, "How does this work?");
    expect(r.status).toBe(0);

    const triagePath = path.join(p.dir, ".cursor", "goal", "triage-log.jsonl");
    const raw = await readFile(triagePath, "utf8");
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]!) as { mode?: string };
    expect(last.mode).toBe("chat");
  });

  it("stop is idle when governance inactive and no GOAL", async () => {
    const p = await mkGitProject("i51-idle");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).toBe("idle");
  });

  it("preToolUse allows Write in chat mode without GOAL", async () => {
    const p = await mkGitProject("i51-pretool");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeSessionMode(p.dir, "chat", "cli");

    const r = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: "src/new.ts",
    });
    expect(r.stdout.permission).toBe("allow");
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { goalLoopPath, readRepoBlockedStopTotal } from "../../src/lib/goal-loop.js";
import {
  readAgentRuntimeState,
  writeAgentRuntimeState,
} from "../../src/lib/agent-runtime-state.js";

function expectHookOk(r: ReturnType<typeof spawnSync>): void {
  expect(r.status, r.stderr || r.stdout).toBe(0);
}

describe("I63 sessionStart stale-only compile", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("does not invalidate runtime state when GOAL.md is already freshly compiled", async () => {
    const p = await mkGitProject("i63-fresh");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeFile(
      goalLoopPath(p.dir),
      JSON.stringify({ total_blocked_stops: 7, loop_limit: 40, updated_at: new Date().toISOString() }),
      "utf8",
    );
    await writeAgentRuntimeState(p.dir, "agent-a", {
      mode: "runtime",
      loop_count: 4,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: true,
      blockers: ["npm test"],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-sessionStart.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ conversation_id: "agent-a" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expectHookOk(r);
    expect(await readRepoBlockedStopTotal(p.dir)).toBe(7);
    const handoff = await readAgentRuntimeState(p.dir, "agent-a");
    expect(handoff?.blocked).toBe(true);
    expect(handoff?.blockers).toContain("npm test");
  });

  it("compiles when GOAL.md exists but compiled work-unit artifacts are missing", async () => {
    const p = await mkGitProject("i63-missing-artifact");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### mod-a
A
- \`pkg/a/\`
## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await rm(path.join(p.dir, ".cursor/goal/work-units.json"), { force: true });

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-sessionStart.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: "{}",
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expectHookOk(r);
    expect(existsSync(path.join(p.dir, ".cursor/goal/work-units.json"))).toBe(true);
  });

  it("does not compile GOAL.md when default mode is chat", async () => {
    const p = await mkGitProject("i63-chat-no-compile");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Scope\n- `pkg/a/`\n## Checks\n- `true`\n",
      "utf8",
    );
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/config.json"),
      JSON.stringify({ default_mode: "chat" }),
      "utf8",
    );

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-sessionStart.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ conversation_id: "chat-agent" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expectHookOk(r);
    expect(existsSync(path.join(p.dir, ".cursor/goal/work-units.json"))).toBe(false);
  });

  it("compiles when session mode is governed even if default mode is chat", async () => {
    const p = await mkGitProject("i63-governed-session-overrides-chat-default");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### mod-a
A
- \`pkg/a/\`
## Checks
- \`true\`
`,
      "utf8",
    );
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/config.json"),
      JSON.stringify({ default_mode: "chat" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/session-mode.json"),
      JSON.stringify({
        mode: "governed",
        source: "cli",
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-sessionStart.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ conversation_id: "governed-agent" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expectHookOk(r);
    expect(existsSync(path.join(p.dir, ".cursor/goal/work-units.json"))).toBe(true);
  });

  it("recovers malformed generated manifest during session-start compile", async () => {
    const p = await mkGitProject("i63-malformed-manifest-recovery");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### mod-a
A
- \`pkg/a/\`
## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    const manifest = path.join(p.dir, ".cursor/goal/manifest.json");
    await writeFile(manifest, "{not json", "utf8");

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-sessionStart.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ conversation_id: "governed-agent" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expectHookOk(r);
    const recoveredManifest = await readFile(manifest, "utf8");
    expect(() => JSON.parse(recoveredManifest)).not.toThrow();
    expect(existsSync(path.join(p.dir, ".cursor/goal/work-units.json"))).toBe(true);
  });
});

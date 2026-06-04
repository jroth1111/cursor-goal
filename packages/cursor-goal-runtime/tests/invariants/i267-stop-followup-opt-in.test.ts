import { describe, it, expect, afterEach } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { writeSessionMode } from "../../src/lib/governance-config.js";

function runRuntimeStop(
  root: string,
  env: Record<string, string | undefined> = {},
): Record<string, unknown> {
  const hook = path.resolve(import.meta.dirname, "../../dist/hook-stop.mjs");
  const r = spawnSync("node", [hook], {
    cwd: root,
    input: JSON.stringify({ status: "completed", conversation_id: "conv-a", loop_count: 0 }),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      CURSOR_PROJECT_DIR: root,
    },
  });
  expect(r.status, r.stderr || r.stdout).toBe(0);
  return JSON.parse((r.stdout ?? "{}").trim() || "{}") as Record<string, unknown>;
}

function runMinimalStop(
  root: string,
  env: Record<string, string | undefined> = {},
): Record<string, unknown> {
  const hook = path.resolve(
    import.meta.dirname,
    "../../../../core/.cursor/hooks/verify-minimal.sh",
  );
  const r = spawnSync("bash", [hook, "stop"], {
    cwd: root,
    input: JSON.stringify({ status: "completed", conversation_id: "conv-a", loop_count: 0 }),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      CURSOR_PROJECT_DIR: root,
    },
  });
  expect(r.status, r.stderr || r.stdout).toBe(0);
  return JSON.parse((r.stdout ?? "{}").trim() || "{}") as Record<string, unknown>;
}

describe("I267 stop followup injection is explicit opt-in", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  async function seedFailingGovernedGoal(prefix: string) {
    const p = await mkGitProject(prefix);
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nStop should verify without injecting user turns\n## Checks\n- `false`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeSessionMode(p.dir, "governed", "triage");
    return p;
  }

  it("runtime stop records blocked state without queueing a user turn by default", async () => {
    const p = await seedFailingGovernedGoal("i267-runtime-default");

    const out = runRuntimeStop(p.dir, { CURSOR_GOAL_STOP_FOLLOWUP: undefined });

    expect(out.followup_message).toBeUndefined();
    const state = JSON.parse(await readFile(
      path.join(p.dir, ".cursor/goal/agents/conv-a/runtime-state.json"),
      "utf8",
    )) as { blocked?: boolean };
    expect(state.blocked).toBe(true);
  });

  it("runtime stop preserves the old signed followup only when explicitly enabled", async () => {
    const p = await seedFailingGovernedGoal("i267-runtime-opt-in");

    const out = runRuntimeStop(p.dir, { CURSOR_GOAL_STOP_FOLLOWUP: "1" });

    const msg = String(out.followup_message ?? "");
    expect(msg).toMatch(/^\[governance\]/);
    expect(msg).toMatch(/stop_sig=[a-f0-9]{12}/);
    expect(msg).toMatch(/GOAL loop/);
  });

  it("minimal fallback also avoids queued stop turns unless explicitly enabled", async () => {
    const p = await seedFailingGovernedGoal("i267-minimal");

    const defaultOut = runMinimalStop(p.dir, { CURSOR_GOAL_STOP_FOLLOWUP: undefined });
    const optInOut = runMinimalStop(p.dir, { CURSOR_GOAL_STOP_FOLLOWUP: "1" });

    expect(defaultOut.followup_message).toBeUndefined();
    expect(String(optInOut.followup_message ?? "")).toMatch(/GOAL loop/);
  });
});

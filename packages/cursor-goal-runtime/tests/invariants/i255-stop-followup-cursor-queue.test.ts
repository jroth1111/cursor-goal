import { describe, it, expect, afterEach } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { writeSessionMode } from "../../src/lib/governance-config.js";

function runStop(
  root: string,
  input: Record<string, unknown>,
  extraEnv: Record<string, string | undefined> = {},
): Record<string, unknown> {
  const hook = path.resolve(import.meta.dirname, "../../dist/hook-stop.mjs");
  const r = spawnSync("node", [hook], {
    cwd: root,
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, ...extraEnv, CURSOR_PROJECT_DIR: root },
  });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse((r.stdout ?? "{}").trim() || "{}") as Record<string, unknown>;
}

describe("I255 stop followups are safe Cursor queued prompts", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function seedFailingGoal(prefix: string) {
    const p = await mkGitProject(prefix);
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `node -e \"process.exit(1)\"`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeSessionMode(p.dir, "governed", "triage");
    return p;
  }

  it("only completed stops can queue a followup_message", async () => {
    const p = await seedFailingGoal("i255-status");

    const aborted = runStop(p.dir, { status: "aborted", conversation_id: "conv-a", loop_count: 0 });
    const errored = runStop(p.dir, { status: "error", conversation_id: "conv-a", loop_count: 0 });

    expect(aborted.followup_message).toBeUndefined();
    expect(errored.followup_message).toBeUndefined();
    const trace = await readFile(path.join(p.dir, ".cursor/goal/stop-trace.jsonl"), "utf8");
    expect(trace).toContain('"terminal_status":"aborted"');
    expect(trace).toContain('"terminal_status":"error"');
  });

  it("completed stop followups are compact, signed, and do not include raw task prompts", async () => {
    const p = await seedFailingGoal("i255-compact");

    const out = runStop(
      p.dir,
      { status: "completed", conversation_id: "conv-a", loop_count: 0 },
      { CURSOR_GOAL_STOP_FOLLOWUP: "1" },
    );
    const msg = String(out.followup_message ?? "");
    expect(msg).toMatch(/^\[governance\]/);
    expect(msg).toMatch(/stop_sig=[a-f0-9]{12}/);
    expect(msg.length).toBeLessThanOrEqual(1600);
    expect(msg).not.toMatch(/Task prompt:|Complete work unit|work_unit_id:/);
  });
});

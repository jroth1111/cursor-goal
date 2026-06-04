import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { readAgentRuntimeState, writeAgentRuntimeState } from "../../src/lib/agent-runtime-state.js";
import { readRepoBlockedStopTotal } from "../../src/lib/goal-loop.js";

const MINIMAL = path.resolve(
  import.meta.dirname,
  "../../../../core/.cursor/hooks/verify-minimal.sh",
);

function runMinimalStop(dir: string, input: Record<string, unknown>) {
  return spawnSync("bash", [MINIMAL, "stop"], {
    cwd: dir,
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CURSOR_PROJECT_DIR: dir },
  });
}

describe("I69 minimal verifier lock hygiene", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    restore = undefined;
    cleanup = undefined;
  });

  it("passing minimal checks preserve other agents, exit 0, and do not leak .lock", async () => {
    const p = await mkGitProject("i69-no-release");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "GOAL.md"), "## Goal\nx\n## Checks\n- `true`\n", "utf8");
    await writeAgentRuntimeState(p.dir, "agent-b", {
      mode: "minimal",
      loop_count: 5,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: true,
      blockers: ["x"],
      next_action: null,
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });

    const r = runMinimalStop(p.dir, { status: "completed", loop_count: 0, conversation_id: "agent-a" });
    expect(r.status).toBe(0);

    const b = await readAgentRuntimeState(p.dir, "agent-b");
    expect(b?.blocked).toBe(true);
    expect(b?.loop_count).toBe(5);
    expect(await readRepoBlockedStopTotal(p.dir)).toBe(0);
    expect(existsSync(path.join(p.dir, ".cursor/goal/.lock"))).toBe(false);
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(false);
  });

  it("does not enter locked RELEASE reset when the reset target is malformed", async () => {
    const p = await mkGitProject("i69-no-reset");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "GOAL.md"), "## Goal\nx\n## Checks\n- `true`\n", "utf8");
    await mkdir(path.join(p.dir, ".cursor/goal/runtime-state.json"), { recursive: true });

    const r = runMinimalStop(p.dir, { status: "completed", loop_count: 0, conversation_id: "agent-a" });
    expect(r.status).toBe(0);
    expect(existsSync(path.join(p.dir, ".cursor/goal/.lock"))).toBe(false);
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(false);
  });

  it("normalizes malformed loop totals instead of crashing under lock", async () => {
    const p = await mkGitProject("i69-malformed-total");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "GOAL.md"), "## Goal\nx\n## Checks\n- `false`\n", "utf8");
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/goal-loop.json"),
      JSON.stringify({ total_blocked_stops: "oops" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/runtime-state.json"),
      JSON.stringify({ loop_count: 7 }),
      "utf8",
    );

    const r = runMinimalStop(p.dir, { status: "completed", loop_count: 0, conversation_id: "agent-a" });
    expect(r.status).toBe(0);
    expect(await readRepoBlockedStopTotal(p.dir)).toBe(8);
    expect(existsSync(path.join(p.dir, ".cursor/goal/.lock"))).toBe(false);
  });
});

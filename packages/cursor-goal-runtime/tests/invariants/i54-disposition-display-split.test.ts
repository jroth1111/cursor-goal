import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { readAgentRuntimeState } from "../../src/lib/agent-runtime-state.js";
import { readJson } from "../../src/lib/paths.js";
import { execMinimalStop } from "../hooks/exec-hook.js";
import { seedReleaseReady } from "../helpers/release-ready.js";

describe("I54 disposition budget vs goal loop display", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function seedFailingGoal(dir: string, loopLimit: number) {
    await writeFile(
      path.join(dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    await writeFile(
      path.join(dir, ".cursor/goal/manifest.json"),
      JSON.stringify({ loop_limit: loopLimit }),
      "utf8",
    );
    await seedReleaseReady(dir);
  }

  it("runtime: first blocked stop dispositions when cursor index is 38/40 but display shows goal 1", async () => {
    const p = await mkGitProject("i54-runtime");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedFailingGoal(p.dir, 40);

    const r = await runStopVerifier({ status: "completed", loop_count: 38 });
    expect(r.kind).toBe("disposition");

    const state = await readAgentRuntimeState(p.dir, "default");
    expect(state?.loop_count).toBe(1);

    const disp = await readJson<{ loop_count?: number; summary?: string }>(
      path.join(p.dir, ".cursor/goal/agents/default/DISPOSITION.json"),
    );
    expect(disp?.loop_count).toBe(38);
    expect(String(disp?.summary ?? "")).toContain("GOAL loop 1/40");
    expect(String(disp?.summary ?? "")).toContain("agent stop 38/40");
    expect(existsSync(path.join(p.dir, ".cursor/goal/agents/default/DISPOSITION.json"))).toBe(
      true,
    );
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/DISPOSITION.json"))).toBe(true);
  });

  it("minimal: first blocked stop dispositions on cursor 38/40 with goal loop 1 in runtime-state", async () => {
    const p = await mkGitProject("i54-minimal");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/manifest.json"),
      JSON.stringify({ loop_limit: 40 }),
      "utf8",
    );

    execMinimalStop(p.dir, { status: "completed", loop_count: 38 });

    const state = await readAgentRuntimeState(p.dir, "default");
    expect(state?.loop_count).toBe(1);

    const disp = await readJson<{
      loop_count?: number;
      goal_blocked_count?: number;
      cursor_stop_index?: number;
    }>(path.join(p.dir, ".cursor/goal/agents/default/DISPOSITION.json"));
    expect(disp?.goal_blocked_count).toBe(1);
    expect(disp?.cursor_stop_index).toBe(38);
    expect(disp?.loop_count).toBe(38);
  });
});

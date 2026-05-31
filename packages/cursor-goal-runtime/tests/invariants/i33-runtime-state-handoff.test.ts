import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { markUnitDone } from "../../src/lib/work-units.js";
import { readAgentRuntimeState } from "../../src/lib/agent-runtime-state.js";
import { runtimeStatePath } from "../../src/lib/runtime-state.js";

describe("I33 runtime-state.json handoff on blocked stop", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function seedUnits(p: { dir: string }): Promise<void> {
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship modules

## Work units

### mod-a
Module A
- \`pkg/a/\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeFile(
      path.join(p.dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase: "VERIFY" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/discovery.json"),
      JSON.stringify({ completed: true, notes: "ok" }),
      "utf8",
    );
  }

  it("writes runtime-state.json with next_action when units block stop", async () => {
    const p = await mkGitProject("i33");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedUnits(p);

    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).toBe("continue");
    expect(existsSync(runtimeStatePath(p.dir))).toBe(true);
    const state = await readAgentRuntimeState(p.dir, "default");
    expect(state?.blocked).toBe(true);
    expect(state?.next_action?.unit_id).toBe("mod-a");
    expect(state?.next_action?.task_prompt).toMatch(/work_unit_id: mod-a/);
    if (r.kind === "continue") {
      expect(r.message).toMatch(/runtime-state\.json/);
      expect(r.message).toMatch(/work_unit_id: mod-a/);
    }
  });

  it("clears next_action on RELEASE", async () => {
    const p = await mkGitProject("i33b");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedUnits(p);

    await runStopVerifier({ status: "completed", loop_count: 0 });
    expect((await readAgentRuntimeState(p.dir, "default"))?.next_action).toBeTruthy();

    await markUnitDone("mod-a", p.dir);
    const fin = await runStopVerifier({ status: "completed", loop_count: 1 });
    expect(fin.kind).toBe("release");
    const state = await readAgentRuntimeState(p.dir, "default");
    expect(state?.blocked).toBe(false);
    expect(state?.next_action).toBeNull();
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { execCoreHook } from "../hooks/exec-hook.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { markUnitDone } from "../../src/lib/work-units.js";
import { runtimeStatePath } from "../../src/lib/runtime-state.js";

describe("E2E stop-loop smoke", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it(
    "runs 12 stop-hook iterations with playbook followup then RELEASE",
    async () => {
    const p = await mkGitProject("e2e-stop");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
E2E stop loop with units and failing check

## Work units

### mod-a
Module A
- \`pkg/a/\`

## Checks
- \`false\`
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

    for (let i = 0; i < 12; i++) {
      const runtime = await runStopVerifier({ status: "completed", loop_count: i });
      expect(runtime.kind, `loop ${i}`).toBe("continue");
      if (runtime.kind === "continue") {
        expect(runtime.message.length).toBeGreaterThan(20);
      }
    }

    const hook = execCoreHook(p.dir, "stop", { status: "completed", loop_count: 11 });
    expect(hook.stdout.followup_message).toBeTruthy();

    expect(existsSync(runtimeStatePath(p.dir))).toBe(true);

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
E2E stop loop with units and passing check

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
    await markUnitDone("mod-a", p.dir);

    const fin = await runStopVerifier({ status: "completed", loop_count: 12 });
    expect(fin.kind).toBe("release");
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(true);
    const { readAgentRuntimeState } = await import("../../src/lib/agent-runtime-state.js");
    const state = await readAgentRuntimeState(p.dir, "default");
    expect(state?.blocked).toBe(false);
    },
    30_000,
  );
});

import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { readAgentRuntimeState } from "../../src/lib/agent-runtime-state.js";

describe("I39 next_action ranks dispatch_unit above phase", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("prefers dispatch_unit when phase and units both block", async () => {
    const p = await mkGitProject("i39");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship modules

## Work units

### mod-a
Module A
- \`pkg/a/\`

## Checks
- \`false\`

## Forbidden proxies
- Tests pass alone without acceptance
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeFile(
      path.join(p.dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase: "DISCOVERY" }),
      "utf8",
    );

    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).toBe("continue");
    const state = await readAgentRuntimeState(p.dir, "default");
    expect(state?.next_action?.kind).toBe("dispatch_unit");
    expect(state?.next_action?.kind).not.toBe("phase");
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { readAgentRuntimeState } from "../../src/lib/agent-runtime-state.js";
import { seedReleaseReady } from "../helpers/release-ready.js";

describe("I34 last_check_fail embedded in runtime-state.json", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("embeds check output in runtime-state.json when checks fail", async () => {
    const p = await mkGitProject("i34");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `echo fail 1>&2; exit 1`\n",
      "utf8",
    );
    await seedReleaseReady(p.dir);

    await runStopVerifier({ status: "completed", loop_count: 0 });
    const state = await readAgentRuntimeState(p.dir, "default");
    expect(state?.last_check_fail?.cmd).toMatch(/echo fail/);
    expect(state?.last_check_fail?.output).toMatch(/fail/);
    expect(state?.last_check_fail?.at).toBeTruthy();
  });
});

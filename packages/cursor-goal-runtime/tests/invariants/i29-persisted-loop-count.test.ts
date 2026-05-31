import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { readAgentRuntimeState } from "../../src/lib/agent-runtime-state.js";
import { seedReleaseReady } from "../helpers/release-ready.js";

describe("I29 persisted loop count", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("I29a: increments goal counter with hook loop_count 0 until disposition", async () => {
    const p = await mkGitProject("i29a");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/manifest.json"),
      JSON.stringify({ loop_limit: 5 }),
      "utf8",
    );
    await seedReleaseReady(p.dir);

    await runStopVerifier({ status: "completed", loop_count: 0 });
    const mid = await readAgentRuntimeState(p.dir, "default");
    expect(mid?.loop_count).toBe(1);

    await runStopVerifier({ status: "completed", loop_count: 0 });
    const mid2 = await readAgentRuntimeState(p.dir, "default");
    expect(mid2?.loop_count).toBe(2);

    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).toBe("disposition");
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/DISPOSITION.json"))).toBe(true);
    const fin = await readAgentRuntimeState(p.dir, "default");
    expect(fin?.loop_count).toBe(3);
  });
});

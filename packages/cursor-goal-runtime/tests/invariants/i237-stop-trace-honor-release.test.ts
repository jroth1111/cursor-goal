import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { readStopTraceTail } from "../../src/lib/stop-trace.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import {
  markUnitDoneWithEvidence,
  seedReleaseReady,
} from "../helpers/release-ready.js";

describe("I237 stop trace records revalidated RELEASE passports", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("appends release trace lines for consecutive honorRelease stops", async () => {
    const p = await mkGitProject("i237");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship

## Scope
- \`pkg/\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await mkdir(path.join(p.dir, "pkg"), { recursive: true });
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await markUnitDoneWithEvidence("pkg", p.dir);

    const first = await runStopVerifier({
      status: "completed",
      loop_count: 0,
      conversation_id: "agent-i237",
    });
    expect(first.kind).toBe("release");

    for (const loop of [1, 2]) {
      const r = await runStopVerifier({
        status: "completed",
        loop_count: loop,
        conversation_id: "agent-i237",
        stop_hook_active: true,
      });
      expect(r.kind).toBe("release");
    }

    const tail = await readStopTraceTail(p.dir, 10);
    const honorReleases = tail.filter(
      (e) => e.pipeline_result === "release" && e.honor_passport === true,
    );
    expect(honorReleases.length).toBeGreaterThanOrEqual(2);
  }, 20000);
});

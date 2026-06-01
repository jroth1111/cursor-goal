import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import {
  markUnitDoneWithEvidence,
  seedReleaseReady,
} from "../helpers/release-ready.js";

describe("I211 stop honors RELEASE passport", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("returns release on later stops without re-emitting unit dispatch", async () => {
    const p = await mkGitProject("i211");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship one unit

## Scope
- \`pkg/\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await markUnitDoneWithEvidence("pkg", p.dir);

    const first = await runStopVerifier({
      status: "completed",
      loop_count: 0,
      conversation_id: "agent-i211",
    });
    expect(first.kind).toBe("release");
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(true);

    const second = await runStopVerifier({
      status: "completed",
      loop_count: 3,
      conversation_id: "agent-i211",
      stop_hook_active: true,
    });
    expect(second.kind).toBe("release");
    if (second.kind === "continue") {
      expect(second.message).not.toMatch(/Dispatch work unit/i);
    }
  });
});

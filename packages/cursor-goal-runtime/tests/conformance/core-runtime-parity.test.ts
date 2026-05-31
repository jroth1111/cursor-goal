import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { seedReleaseReady } from "../helpers/release-ready.js";
import { execMinimalStop } from "../hooks/exec-hook.js";
import { runStopVerifier } from "../../src/lib/verify.js";

describe("I10 core/runtime parity", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function parityCase(name: string, goalMd: string, loopCount: number) {
    const p = await mkGitProject(`i10-${name}`);
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "GOAL.md"), goalMd, "utf8");
    await seedReleaseReady(p.dir);
    const stdin = { status: "completed", loop_count: loopCount };
    const core = execMinimalStop(p.dir, stdin);
    const runtime = await runStopVerifier(stdin);
    const coreReleased = !core.stdout.followup_message && core.raw === "{}";
    const runtimeReleased = runtime.kind === "release";
    expect(coreReleased).toBe(runtimeReleased);
    if (!coreReleased) {
      expect(core.stdout.followup_message || runtime.kind === "continue").toBeTruthy();
    }
  }

  it("empty checks: both block release", async () => {
    await parityCase("empty", "## Goal\nx\n## Checks\n\n", 0);
  });

  it("passing check: both release", async () => {
    await parityCase("pass", "## Goal\nx\n## Checks\n- `true`\n", 0);
  });

  it("failing check: both continue", async () => {
    await parityCase("fail", "## Goal\nx\n## Checks\n- `false`\n", 0);
  });

  it("stuck cursor loop_count: both show monotonic goal loop", async () => {
    const stdinBase = { status: "completed" as const, loop_count: 25 };
    const goalMd = "## Goal\nx\n## Checks\n- `false`\n";
    const manifest = JSON.stringify({ loop_limit: 40 });

    const pCore = await mkGitProject("i10-stuck-core");
    const pRt = await mkGitProject("i10-stuck-rt");
    cleanup = async () => {
      await pCore.cleanup();
      await pRt.cleanup();
    };
    restore = withProjectEnv(pRt.dir).restore;

    for (const p of [pCore, pRt]) {
      await writeFile(path.join(p.dir, "GOAL.md"), goalMd, "utf8");
      await writeFile(path.join(p.dir, ".cursor/goal/manifest.json"), manifest, "utf8");
      await seedReleaseReady(p.dir);
    }

    for (let n = 1; n <= 3; n++) {
      const coreMsg = String(
        execMinimalStop(pCore.dir, stdinBase).stdout.followup_message ?? "",
      );
      expect(coreMsg).toContain(`GOAL loop ${n}/40`);

      const runtime = await runStopVerifier(stdinBase);
      expect(runtime.kind).toBe("continue");
      if (runtime.kind === "continue") {
        expect(runtime.message).toContain(`GOAL loop ${n}/40`);
      }
    }
  });
});

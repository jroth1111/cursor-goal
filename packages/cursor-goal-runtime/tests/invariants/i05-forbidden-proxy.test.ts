import { describe, it, expect, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { readAgentRuntimeState } from "../../src/lib/agent-runtime-state.js";
import { seedReleaseReady } from "../helpers/release-ready.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("I05 forbidden proxy", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("blocks release for test-only checks with forbidden proxy rule", async () => {
    const p = await mkGitProject("i05");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const md = await readFile(path.join(fixtures, "adversarial-test-only.md"), "utf8");
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(path.join(p.dir, "GOAL.md"), md, "utf8");
    await seedReleaseReady(p.dir);
    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).toBe("continue");
    const state = await readAgentRuntimeState(p.dir, "default");
    expect(state?.blockers.join(" ")).toMatch(/forbidden-proxy/i);
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { runChecks } from "../../src/lib/run-checks.js";

describe("I97 runChecks evidence directory", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("creates proof-runs evidence path before appending check results", async () => {
    const p = await mkGitProject("i97-run-checks");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const res = await runChecks(p.dir, ["true"]);

    expect(res[0].ok).toBe(true);
    expect(existsSync(path.join(p.dir, ".cursor/goal/evidence/proof-runs.jsonl"))).toBe(true);
  });
});

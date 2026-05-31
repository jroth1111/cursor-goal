import { describe, it, expect, afterEach } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { execCoreHook } from "../hooks/exec-hook.js";
import { runStopVerifier } from "../../src/lib/verify.js";

describe("subagent work units integration", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("two subagent stops, parent releases when units done", async () => {
    const p = await mkGitProject("int-sub");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Integrate two modules

## Work units

### mod-a
Module A
- \`pkg/a/\`

### mod-b
Module B
- \`pkg/b/\`

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

    await mkdir(path.join(p.dir, "pkg/a"), { recursive: true });
    await mkdir(path.join(p.dir, "pkg/b"), { recursive: true });

    execCoreHook(p.dir, "subagentStop", {
      status: "completed",
      subagent_id: "sub-a",
      work_unit_id: "mod-a",
    });
    execCoreHook(p.dir, "subagentStop", {
      status: "completed",
      subagent_id: "sub-b",
      work_unit_id: "mod-b",
    });

    const fin = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(fin.kind).toBe("release");
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(true);
  });
});

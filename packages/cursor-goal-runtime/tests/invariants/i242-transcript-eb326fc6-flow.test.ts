import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { buildOperatorSnapshot } from "../../src/lib/operator.js";

describe("I242 eb326fc6 /goal control-flow regression", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("routes transcript-shaped phase/scope blockers before unit redispatch", async () => {
    const p = await mkGitProject("i242-eb326fc6");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, "scripts"), { recursive: true });
    await mkdir(path.join(p.dir, "docs"), { recursive: true });
    await writeFile(path.join(p.dir, "scripts", "baseline.py"), "print('ok')\n", "utf8");
    await writeFile(path.join(p.dir, "docs", "AGENTS.md"), "# agents\n", "utf8");
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship day 1-2 baseline

## Scope
- \`scripts/\`
- \`docs/\`

## Work units
### day1-2-baseline
Baseline artifacts
- scope: \`scripts/\`, \`docs/AGENTS.md\`
- acceptance: \`true\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await mkdir(path.join(p.dir, "codex_shim"), { recursive: true });
    await writeFile(path.join(p.dir, "codex_shim", "cli.py"), "print('outside')\n", "utf8");
    await writeFile(
      path.join(p.dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase: "DISCOVERY" }),
      "utf8",
    );
    await mkdir(path.join(p.dir, ".cursor/goal/evidence/units"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/evidence/units/day1-2-baseline.jsonl"),
      JSON.stringify({ work_unit_id: "day1-2-baseline", ok: true, status: "passed" }) + "\n",
      "utf8",
    );

    const snap = await buildOperatorSnapshot(p.dir, { agentId: "eb326fc6" });
    expect("error" in snap).toBe(false);
    if (!("error" in snap)) {
      expect(snap.blocked).toBe(true);
      expect(snap.next_action?.kind).toBe("fix_scope");
      expect(snap.next_action?.detail).toMatch(/codex_shim\/cli\.py/);
      expect(snap.next_action?.kind).not.toBe("dispatch_unit");
      expect(snap.next_action).not.toHaveProperty("task_prompt");
      expect(snap.blockers).toContain("phase:DISCOVERY");
    }
  });
});

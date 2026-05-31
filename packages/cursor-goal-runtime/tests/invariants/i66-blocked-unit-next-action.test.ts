import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { buildOperatorSnapshot } from "../../src/lib/operator.js";

describe("I66 blocked unit next action", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("does not redispatch a pending unit whose latest evidence is blocked", async () => {
    const p = await mkGitProject("i66-blocked-next");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### finalize-run
Finalize
- \`scripts/finalize.py\`
## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await mkdir(path.join(p.dir, ".cursor/goal/evidence/units"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/evidence/units/finalize-run.jsonl"),
      JSON.stringify({
        at: new Date().toISOString(),
        work_unit_id: "finalize-run",
        ok: false,
        blocked: true,
        blocker: "unfinished_tasks > 0",
        preconditions: { unfinished_tasks: 9839 },
        status: "blocked",
      }) + "\n",
      "utf8",
    );

    const snap = await buildOperatorSnapshot(p.dir, { agentId: "agent-a" });
    expect("error" in snap).toBe(false);
    if (!("error" in snap)) {
      expect(snap.next_action?.kind).toBe("blocked_unit");
      expect(snap.next_action?.headline).toMatch(/finalize-run/);
      expect(snap.next_action?.detail).toMatch(/unfinished_tasks > 0/);
      expect(snap.next_action?.task_prompt).toBeUndefined();
    }
  });
});

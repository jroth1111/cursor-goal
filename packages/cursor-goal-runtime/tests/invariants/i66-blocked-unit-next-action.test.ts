import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
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

  async function seedBlockedUnit(): Promise<{ dir: string }> {
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
    return p;
  }

  it("does not redispatch a pending unit whose latest evidence is blocked", async () => {
    const p = await seedBlockedUnit();

    const snap = await buildOperatorSnapshot(p.dir, { agentId: "agent-a" });
    expect("error" in snap).toBe(false);
    if (!("error" in snap)) {
      expect(snap.next_action?.kind).toBe("blocked_unit");
      expect(snap.next_action?.headline).toMatch(/finalize-run/);
      expect(snap.next_action?.detail).toMatch(/unfinished_tasks > 0/);
      expect(snap.next_action?.task_prompt).toBeUndefined();
    }
  });

  it("supervisor dry-run stops before redispatching a blocked unit", async () => {
    const p = await seedBlockedUnit();
    await mkdir(path.join(p.dir, ".cursor/hooks"), { recursive: true });
    await writeFile(path.join(p.dir, ".cursor/hooks/goal-stop.sh"), "#!/usr/bin/env bash\n", "utf8");

    const supervisor = path.resolve(import.meta.dirname, "../../../../supervisor/run-goal.mjs");
    const r = spawnSync("node", [supervisor, "--dry-run", "--units-only"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    const out = `${r.stdout}\n${r.stderr}`;
    expect(out).toMatch(/Blocked unit: finalize-run/);
    expect(out).not.toMatch(/Dispatch unit: finalize-run/);
  });
});
